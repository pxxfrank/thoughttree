//! Background sampler for the foreground window that is *not* ours.
//!
//! At the instant a capture fires, our own capture/orb window is the foreground
//! window, so asking Win32 on demand would only ever return ThoughtTree. A small
//! thread instead samples the foreground window continuously and remembers the
//! last one that belonged to another process — the context the thought came
//! from. `capture_source_context` then just hands back that snapshot, which works
//! the same for the orb, the global shortcut and the in-app capture bar.

use crate::windows::CaptureSource;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The most recent capture source seen by the sampler.
#[derive(Default)]
pub struct ContextSlot(pub Mutex<CaptureSource>);

/// How often the foreground window is sampled. Fast enough to be current, slow
/// enough to stay invisible in a process listing.
const SAMPLE_MS: u64 = 400;

/// Clone out of the slot. A poisoned lock yields an empty context rather than
/// propagating the panic.
pub fn current(slot: &ContextSlot) -> CaptureSource {
    match slot.0.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => CaptureSource {
            app: None,
            title: None,
        },
    }
}

/// Starts the sampler thread. The thread runs for the life of the process.
#[cfg(target_os = "windows")]
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(SAMPLE_MS));
        sample_once(&app);
    });
}

#[cfg(not(target_os = "windows"))]
pub fn start(_app: &AppHandle) {}

/// True when `hwnd` is one of the windows this app owns.
#[cfg(target_os = "windows")]
fn is_ours(app: &AppHandle, hwnd: *mut std::ffi::c_void) -> bool {
    for label in ["main", "capture", "orb"] {
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
/// process it belongs to. Handles are dropped immediately and nothing unwraps.
#[cfg(target_os = "windows")]
fn sample_once(app: &AppHandle) {
    use std::ffi::c_void;

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

        if let Some(slot) = app.try_state::<ContextSlot>() {
            if let Ok(mut guard) = slot.0.lock() {
                *guard = CaptureSource {
                    app: app_name,
                    title,
                };
            }
        }
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
