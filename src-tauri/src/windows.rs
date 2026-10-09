use crate::db;
use crate::platform;
use crate::AppDb;
use serde::Serialize;
use tauri::{
    App, AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Alt+Space is a trap: Windows uses it for the window system menu, so a
/// RegisterHotKey on it reports success but never fires. Ctrl+Shift+Space is
/// free by default and matches what other capture-first apps use.
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";

/// `Alt+Space` opens the Windows system menu. `RegisterHotKey` reports success
/// for it but the hotkey is never delivered, so it is a value that *looks* set
/// and is silently dead. An earlier build defaulted to it and a *Reset* button
/// wrote it into settings; recognising it here lets us heal that stale value.
const DEAD_SHORTCUT: &str = "Alt+Space";

#[derive(Serialize, Default, Clone)]
pub struct CaptureSource {
    pub app: Option<String>,
    pub title: Option<String>,
    /// The browser address bar at sample time, when it could be read. `None`
    /// serialises as `null`, which is what the front end expects.
    pub url: Option<String>,
}

/// --- Windows created at startup -------------------------------------------
///
/// The main and capture windows are built here rather than declared in
/// `tauri.conf.json`, because config windows are created *before* the setup hook
/// runs. A packaged front end boots from embedded assets and calls `db_load`
/// within milliseconds, so the database has to be managed first.

pub fn create_main_window(app: &App) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("ThoughtTree")
        .inner_size(1100.0, 720.0)
        .min_inner_size(880.0, 520.0)
        .center()
        .build()?;
    fit_main_window(app.handle());
    Ok(())
}

pub fn create_capture_window(app: &App) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "capture", WebviewUrl::App("capture.html".into()))
        .title("Quick Capture")
        .inner_size(620.0, 104.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .build()?;
    Ok(())
}

/// --- Quick capture window -------------------------------------------------

pub fn open_capture(app: &AppHandle) {
    let Some(win) = app.get_webview_window("capture") else {
        return;
    };
    position_capture(app, &win);
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.set_always_on_top(true);
    platform::strip_chrome(&win);
}

pub fn hide_capture(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("capture") {
        let _ = win.hide();
    }
}

/// Toggle used by the global shortcut, so hitting the accelerator twice in a
/// row never leaves a stray always-on-top window behind.
pub fn toggle_capture(app: &AppHandle) {
    let Some(win) = app.get_webview_window("capture") else {
        return;
    };
    let visible = win.is_visible().unwrap_or(false);
    let focused = win.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = win.hide();
    } else {
        open_capture(app);
    }
}

fn position_capture(app: &AppHandle, win: &WebviewWindow) {
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let size = win
        .outer_size()
        .unwrap_or(PhysicalSize::new(620, 104));
    let mpos = monitor.position();
    let msize = monitor.size();
    let x = mpos.x + (msize.width as i32 - size.width as i32) / 2;
    let y = mpos.y + (msize.height as f64 * 0.16) as i32;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        platform::force_foreground(&win);
    }
}

/// Shrinks the main window to fit the current monitor. Called both right after
/// creation and again once the window is really on screen — the monitor and the
/// final frame size are not always settled at creation time.
pub fn fit_main_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    // Compare physical with physical. Mixing logical sizes and scale factors is
    // how this silently failed before.
    let area = monitor.size();
    let margin = (64.0 * monitor.scale_factor()) as u32;
    let max_width = area.width.saturating_sub(32);
    let max_height = area.height.saturating_sub(margin);
    let Ok(size) = win.outer_size() else {
        return;
    };
    if size.width > max_width || size.height > max_height {
        let _ = win.set_size(PhysicalSize::new(
            size.width.min(max_width),
            size.height.min(max_height),
        ));
        let _ = win.center();
    }
}

/// A freshly created window can end up minimized by the environment it was
/// launched into — a remote session, a window manager, or a shortcut that starts
/// minimised. The window's own event stream gives no hint, so check for the first
/// few seconds and put it back. Restoring always wins: a visible main window on
/// launch is the one thing the app must never get wrong.
pub fn watch_main_window(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        fit_main_window(&app);
        for _ in 0..50 {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let Some(win) = app.get_webview_window("main") else {
                break;
            };
            let iconic = platform::is_iconic(&win);
            let hidden = !win.is_visible().unwrap_or(true);
            if iconic || hidden {
                show_main(&app);
            }
        }
    });
}

/// --- Global shortcut ------------------------------------------------------
pub fn current_shortcut_accel(app: &AppHandle) -> String {
    let db = app.state::<AppDb>();
    let stored = db
        .with(|conn| Ok(db::get_setting(conn, "shortcut").ok().flatten()))
        .unwrap_or(None);
    match stored {
        Some(v) if v.is_empty() => String::new(),
        // A stale `Alt+Space` outlives the fix that moved the default off it,
        // because a *Reset* button persisted the old value. Fall back to the
        // default and heal the row so the correction happens exactly once.
        Some(v) if v.trim() == DEAD_SHORTCUT => {
            let _ = db.with(|conn| {
                db::set_setting(conn, "shortcut", DEFAULT_SHORTCUT).map_err(|e| e.to_string())
            });
            DEFAULT_SHORTCUT.to_string()
        }
        Some(v) => v,
        None => DEFAULT_SHORTCUT.to_string(),
    }
}

pub fn register_shortcut(app: &AppHandle, accel: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    if accel.trim().is_empty() {
        return Ok(());
    }
    let shortcut: Shortcut = accel.parse().map_err(|_| format!("invalid shortcut: {accel}"))?;
    gs.on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            if let Some(win) = app.get_webview_window("capture") {
                if !win.is_visible().unwrap_or(false) {
                    position_capture(app, &win);
                }
            }
            toggle_capture(app);
        }
    })
    .map_err(|e| e.to_string())
}

/// Reports whether the global shortcut is actually live.
///
/// Called by the front end a moment after startup: by then a previous instance
/// has finished releasing the hotkey, so this doubles as a retry. It returns the
/// accelerator as the error so the UI can name it.
#[tauri::command]
pub fn shortcut_status(app: AppHandle) -> Result<(), String> {
    let accel = current_shortcut_accel(&app);
    if accel.trim().is_empty() {
        return Ok(());
    }
    register_shortcut(&app, &accel).map_err(|_| accel)
}

/// --- Commands -------------------------------------------------------------

#[tauri::command]
pub fn open_capture_window(app: AppHandle) -> Result<(), String> {
    open_capture(&app);
    Ok(())
}

#[tauri::command]
pub fn hide_capture_window(app: AppHandle) -> Result<(), String> {
    hide_capture(&app);
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_main(&app);
    Ok(())
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Clamp the main window to the monitor using the *front end's* measurement.
///
/// Rust's `outer_size()` disagrees with the window's real painted extent on a
/// high-DPI remote session, so the previous Rust-side clamp could not be
/// trusted. The front end knows `innerWidth * devicePixelRatio`, which is the
/// same space the layout uses, so it does the measuring and this does the
/// resizing.
#[tauri::command]
pub fn fit_main_to_screen(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(win) = app.get_webview_window("main") else {
        return Ok(());
    };
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let area = monitor.size();
    // Leave room for the title bar and the taskbar.
    let max_width = area.width as f64 * 0.94;
    let max_height = area.height as f64 * 0.90;
    let target_width = width.min(max_width).max(560.0);
    let target_height = height.min(max_height).max(380.0);
    if target_width < width - 1.0 || target_height < height - 1.0 {
        let _ = win.set_size(PhysicalSize::new(
            target_width.round() as u32,
            target_height.round() as u32,
        ));
        let _ = win.center();
    }
    Ok(())
}

/// Match the native window chrome to the app theme. A white UI under a black
/// title bar looks broken, and on Windows the title bar follows this setting.
#[tauri::command]
pub fn set_app_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let native = match theme.as_str() {
        "light" => tauri::Theme::Light,
        _ => tauri::Theme::Dark,
    };
    for label in ["main", "capture"] {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.set_theme(Some(native));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn capture_source_context(state: State<'_, crate::context::ContextSlot>) -> CaptureSource {
    crate::context::current(&state)
}

#[tauri::command]
pub fn set_shortcut(app: AppHandle, state: State<'_, AppDb>, accel: String) -> Result<(), String> {
    let trimmed = accel.trim().to_string();
    if !trimmed.is_empty() {
        // Parse first so a bad accelerator never unregisters a working one.
        trimmed
            .parse::<Shortcut>()
            .map_err(|_| format!("invalid shortcut: {trimmed}"))?;
    }
    register_shortcut(&app, &trimmed)?;
    state.with(|conn| db::set_setting(conn, "shortcut", &trimmed).map_err(|e| e.to_string()))?;
    Ok(())
}
