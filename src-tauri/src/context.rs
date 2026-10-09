//! Background sampler for the foreground window that is *not* ours.
//!
//! At the instant a capture fires, our own capture window is the foreground
//! window, so asking Win32 on demand would only ever return ThoughtTree. A small
//! thread instead samples the foreground window continuously and remembers the
//! last one that belonged to another process — the context the thought came
//! from. `capture_source_context` then just hands back that snapshot, which works
//! the same for the global shortcut and the in-app capture bar.

use crate::windows::CaptureSource;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The most recent capture source seen by the sampler.
#[derive(Default)]
pub struct ContextSlot(pub Mutex<CaptureSource>);

/// How often the foreground window is sampled. Fast enough to be current, slow
/// enough to stay invisible in a process listing.
const SAMPLE_MS: u64 = 400;

/// Minimum spacing between UI Automation reads. Probing a browser's
/// accessibility tree is far heavier than the cheap Win32 foreground query, so
/// the sampler only pays for it occasionally and reuses the last value in
/// between.
const URL_READ_MS: u64 = 1000;

/// Clone out of the slot. A poisoned lock yields an empty context rather than
/// propagating the panic.
pub fn current(slot: &ContextSlot) -> CaptureSource {
    match slot.0.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => CaptureSource {
            app: None,
            title: None,
            url: None,
        },
    }
}

/// Starts the sampler thread. The thread runs for the life of the process.
#[cfg(target_os = "windows")]
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Built once on this thread, before the loop: UI Automation is
        // apartment-bound and rebuilding it every tick would be wasteful. A
        // `None` here just means no URLs are captured — the sampler keeps
        // running either way and never aborts.
        let reader = crate::browser::AddressBarReader::new();
        let mut last_read: Option<std::time::Instant> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(SAMPLE_MS));
            sample_once(&app, reader.as_ref(), &mut last_read);
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn start(_app: &AppHandle) {}

/// True when `hwnd` is one of the windows this app owns.
#[cfg(target_os = "windows")]
fn is_ours(app: &AppHandle, hwnd: *mut std::ffi::c_void) -> bool {
    for label in ["main", "capture"] {
        if let Some(win) = app.get_webview_window(label) {
            if let Ok(handle) = win.hwnd() {
                if handle.0 == hwnd {
                    return true;
                }
            }
        }
    }
    false
}

/// One tick: read the foreground window and, when it is not ours, remember the
/// process it belongs to — plus, for a real browser, the address bar. Handles
/// are dropped immediately and nothing unwraps.
#[cfg(target_os = "windows")]
fn sample_once(
    app: &AppHandle,
    reader: Option<&crate::browser::AddressBarReader>,
    last_read: &mut Option<std::time::Instant>,
) {
    use std::ffi::c_void;
    use windows::Win32::Foundation::HWND;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const MAX_TITLE: usize = 512;
    const MAX_PATH: usize = 1024;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowTextW(hwnd: *mut c_void, text: *mut u16, max: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, pid: *mut u32) -> u32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn QueryFullProcessImageNameW(
            process: *mut c_void,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return;
        }
        // While our own window is foreground we keep the last good value.
        if is_ours(app, hwnd) {
            return;
        }

        let mut title_buf = [0u16; MAX_TITLE];
        let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), MAX_TITLE as i32);
        let title = if title_len > 0 {
            Some(String::from_utf16_lossy(
                &title_buf[..title_len as usize],
            ))
        } else {
            None
        };

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let mut app_name = None;
        if pid != 0 {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !process.is_null() {
                let mut path_buf = [0u16; MAX_PATH];
                let mut size = MAX_PATH as u32;
                let ok = QueryFullProcessImageNameW(process, 0, path_buf.as_mut_ptr(), &mut size);
                if ok != 0 {
                    let path = String::from_utf16_lossy(&path_buf[..size as usize]);
                    app_name = Some(app_name_from_path(&path));
                }
                CloseHandle(process);
            }
        }

        // Start from the value already stored and only ever replace it with a
        // good one: a failed, empty, or too-frequent read must not wipe the
        // last URL the same way our own window must not wipe app/title.
        let mut url = stored_url(app);
        if !capture_url_enabled(app) {
            url = None;
        } else if app_name.as_deref().map(crate::browser::is_browser).unwrap_or(false) {
            let now = std::time::Instant::now();
            let due = match *last_read {
                Some(previous) => {
                    now.duration_since(previous).as_millis() as u64 >= URL_READ_MS
                }
                None => true,
            };
            if due {
                *last_read = Some(now);
                if let Some(reader) = reader {
                    if let Some(found) = reader.read(HWND(hwnd)) {
                        url = Some(found);
                    }
                }
            }
        }

        if let Some(slot) = app.try_state::<ContextSlot>() {
            if let Ok(mut guard) = slot.0.lock() {
                *guard = CaptureSource {
                    app: app_name,
                    title,
                    url,
                };
            }
        }
    }
}

/// The URL currently stored in the slot, if any. A poisoned lock reads as none.
#[cfg(target_os = "windows")]
fn stored_url(app: &AppHandle) -> Option<String> {
    let slot = app.try_state::<ContextSlot>()?;
    let guard = slot.0.lock().ok()?;
    guard.url.clone()
}

/// Whether URL capture is enabled. Anything other than an explicit `"off"` —
/// including a missing setting or an unreadable database — counts as on.
#[cfg(target_os = "windows")]
fn capture_url_enabled(app: &AppHandle) -> bool {
    let Some(db) = app.try_state::<crate::AppDb>() else {
        return true;
    };
    match db.with(|conn| Ok(crate::db::get_setting(conn, "capture_url").ok().flatten())) {
        Ok(Some(value)) => value != "off",
        _ => true,
    }
}

/// The executable's file stem, e.g. `C:\...\notepad.exe` → `notepad`.
fn app_name_from_path(path: &str) -> String {
    // `rsplit` always yields at least one element, so the fallback is unused.
    let file = match path.rsplit(|c| c == '\\' || c == '/').next() {
        Some(name) => name,
        None => path,
    };
    match file.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem.to_string(),
        _ => file.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::app_name_from_path;

    #[test]
    fn app_name_is_the_executable_stem() {
        assert_eq!(app_name_from_path(r"C:\Windows\System32\notepad.exe"), "notepad");
        assert_eq!(app_name_from_path("firefox"), "firefox");
        assert_eq!(app_name_from_path(r"C:\Program Files\App\editor"), "editor");
    }
}
