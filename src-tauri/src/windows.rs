use crate::db;
use crate::platform;
use crate::AppDb;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    App, AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const DEFAULT_SHORTCUT: &str = "Alt+Space";

const ORB_MARGIN: i32 = 8;
const ORB_PEEK_VISIBLE: i32 = 10;
const ORB_SIZE: f64 = 64.0;

#[derive(Default)]
pub struct OrbRuntime {
    pub edge: Option<String>,
    pub anchor: Option<(i32, i32)>,
    pub peeking: bool,
}

#[derive(Default)]
pub struct OrbState(pub Mutex<OrbRuntime>);

#[derive(Serialize)]
pub struct CaptureSource {
    pub app: Option<String>,
    pub title: Option<String>,
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
        .inner_size(1200.0, 780.0)
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

/// --- Floating orb ---------------------------------------------------------

fn orb_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("orb")
}

fn monitor_for(win: &WebviewWindow) -> Option<Monitor> {
    win.current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten())
}

fn persist_orb(app: &AppHandle, x: i32, y: i32, edge: &str) {
    let db = app.state::<AppDb>();
    let _ = db.with(|conn| {
        let _ = db::set_setting(conn, "orb_x", &x.to_string());
        let _ = db::set_setting(conn, "orb_y", &y.to_string());
        let _ = db::set_setting(conn, "orb_edge", edge);
        Ok(())
    });
}

/// The orb must be a true circle, so drop the caption styles Windows uses to
/// enforce a minimum window width, then re-apply the exact size.
fn fit_orb(win: &WebviewWindow) {
    platform::strip_chrome(win);
    let scale = win.scale_factor().unwrap_or(1.0);
    let side = (ORB_SIZE * scale).round() as u32;
    let _ = win.set_size(PhysicalSize::new(side, side));
}

/// Snaps the orb to the nearest vertical screen edge and remembers the result.
pub fn orb_snap(app: &AppHandle) -> Result<(), String> {
    let win = orb_window(app).ok_or("orb window not found")?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let monitor = monitor_for(&win).ok_or("no monitor")?;

    let mpos = monitor.position();
    let msize = monitor.size();
    let center_x = pos.x + size.width as i32 / 2;
    let monitor_center = mpos.x + msize.width as i32 / 2;
    let on_left = center_x < monitor_center;

    let x = if on_left {
        mpos.x + ORB_MARGIN
    } else {
        mpos.x + msize.width as i32 - size.width as i32 - ORB_MARGIN
    };
    let min_y = mpos.y + ORB_MARGIN;
    let max_y = mpos.y + msize.height as i32 - size.height as i32 - ORB_MARGIN;
    let y = pos.y.clamp(min_y, max_y.max(min_y));

    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    let edge = if on_left { "left" } else { "right" };
    {
        let state = app.state::<OrbState>();
        let mut rt = state.0.lock().map_err(|e| e.to_string())?;
        rt.edge = Some(edge.to_string());
        rt.anchor = Some((x, y));
        rt.peeking = false;
    }
    persist_orb(app, x, y, edge);
    Ok(())
}

/// Slides the orb mostly off-screen so it stops covering other windows.
pub fn orb_peek(app: &AppHandle) -> Result<(), String> {
    let win = orb_window(app).ok_or("orb window not found")?;
    let state = app.state::<OrbState>();
    let (anchor, edge, already) = {
        let rt = state.0.lock().map_err(|e| e.to_string())?;
        (rt.anchor, rt.edge.clone(), rt.peeking)
    };
    if already {
        return Ok(());
    }
    let Some((ax, ay)) = anchor else {
        return Ok(());
    };
    let width = win.outer_size().map_err(|e| e.to_string())?.width as i32;
    let peek = (ORB_PEEK_VISIBLE as f64 * win.scale_factor().unwrap_or(1.0)) as i32;
    let x = match edge.as_deref() {
        Some("left") => ax - (width - peek),
        _ => ax + (width - peek),
    };
    win.set_position(PhysicalPosition::new(x, ay))
        .map_err(|e| e.to_string())?;
    let mut rt = state.0.lock().map_err(|e| e.to_string())?;
    rt.peeking = true;
    Ok(())
}

pub fn orb_expand(app: &AppHandle) -> Result<(), String> {
    let win = orb_window(app).ok_or("orb window not found")?;
    let state = app.state::<OrbState>();
    let (anchor, peeking) = {
        let rt = state.0.lock().map_err(|e| e.to_string())?;
        (rt.anchor, rt.peeking)
    };
    if !peeking {
        return Ok(());
    }
    if let Some((ax, ay)) = anchor {
        win.set_position(PhysicalPosition::new(ax, ay))
            .map_err(|e| e.to_string())?;
    }
    let mut rt = state.0.lock().map_err(|e| e.to_string())?;
    rt.peeking = false;
    Ok(())
}

/// Restores the orb on launch: either the remembered anchor or the right edge.
pub fn restore_orb(app: &AppHandle) {
    let Some(win) = orb_window(app) else {
        return;
    };
    let saved = {
        let db = app.state::<AppDb>();
        db.with(|conn| {
            let x = db::get_setting(conn, "orb_x").ok().flatten();
            let y = db::get_setting(conn, "orb_y").ok().flatten();
            let edge = db::get_setting(conn, "orb_edge").ok().flatten();
            Ok(match (x, y, edge) {
                (Some(x), Some(y), Some(edge)) => x
                    .parse::<i32>()
                    .ok()
                    .zip(y.parse::<i32>().ok())
                    .map(|(x, y)| (x, y, edge)),
                _ => None,
            })
        })
        .unwrap_or(None)
    };

    match saved {
        Some((x, y, edge)) => {
            let _ = win.set_position(PhysicalPosition::new(x, y));
            if let Ok(mut rt) = app.state::<OrbState>().0.lock() {
                rt.anchor = Some((x, y));
                rt.edge = Some(edge);
                rt.peeking = false;
            }
        }
        None => {
            // First run: park it against the right edge, about a third down.
            if let Some(monitor) = monitor_for(&win) {
                let mpos = monitor.position();
                let msize = monitor.size();
                let x = mpos.x + msize.width as i32 - (ORB_SIZE as i32) - ORB_MARGIN;
                let y = mpos.y + (msize.height as f64 * 0.32) as i32;
                let _ = win.set_position(PhysicalPosition::new(x, y));
            }
        }
    }

    let _ = win.show();
    let _ = win.set_always_on_top(true);
    // Showing applies Tauri's window attributes, which put the caption styles
    // back and re-clamp the width — so fitting has to be the last word.
    fit_orb(&win);
    let _ = orb_snap(app);
}

/// --- Global shortcut ------------------------------------------------------
pub fn current_shortcut_accel(app: &AppHandle) -> String {
    let db = app.state::<AppDb>();
    let stored = db
        .with(|conn| Ok(db::get_setting(conn, "shortcut").ok().flatten()))
        .unwrap_or(None);
    match stored {
        Some(v) if v.is_empty() => String::new(),
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

#[tauri::command]
pub fn orb_snap_window(app: AppHandle) -> Result<(), String> {
    orb_snap(&app)
}

#[tauri::command]
pub fn orb_peek_window(app: AppHandle) -> Result<(), String> {
    orb_peek(&app)
}

#[tauri::command]
pub fn orb_expand_window(app: AppHandle) -> Result<(), String> {
    orb_expand(&app)
}

#[tauri::command]
pub fn capture_source_context() -> CaptureSource {
    CaptureSource {
        app: None,
        title: None,
    }
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
