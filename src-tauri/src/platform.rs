//! Small Windows-specific window fixes.
//!
//! Tauri's `decorations: false` still leaves `WS_CAPTION | WS_SYSMENU` on the
//! window, and Windows then refuses to make it narrower than `SM_CXMINTRACK`
//! (136px on a default desktop). That turned the 64x64 floating orb into a
//! 136x64 slab. Removing those style bits lets the orb be a real circle.
//!
//! Tauri re-applies the window attributes when a window is shown, so the strip
//! has to happen *after* `show()` — otherwise the caption comes straight back.

#[cfg(target_os = "windows")]
pub fn strip_chrome(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    const GWL_STYLE: i32 = -16;
    const WS_CAPTION: i32 = 0x00C0_0000;
    const WS_SYSMENU: i32 = 0x0008_0000;
    const WS_MINIMIZEBOX: i32 = 0x0002_0000;
    const WS_MAXIMIZEBOX: i32 = 0x0001_0000;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetWindowLongW(hwnd: *mut c_void, index: i32) -> i32;
        fn SetWindowLongW(hwnd: *mut c_void, index: i32, value: i32) -> i32;
    }

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let handle = hwnd.0;
    unsafe {
        let style = GetWindowLongW(handle, GWL_STYLE);
        let cleaned = style & !(WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
        if cleaned != style {
            SetWindowLongW(handle, GWL_STYLE, cleaned);
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn strip_chrome(_window: &tauri::WebviewWindow) {}

/// Brings a window back on screen and to the front.
///
/// Tauri's `unminimize()` only flips its own bookkeeping flag, so once it has
/// been called the native window can stay iconic while every later
/// `show()`/`unminimize()` silently does nothing. Going straight to Win32 is the
/// only reliable way to pull the window back.
#[cfg(target_os = "windows")]
pub fn force_foreground(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    const SW_SHOW: i32 = 5;
    const SW_RESTORE: i32 = 9;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn ShowWindow(hwnd: *mut c_void, cmd: i32) -> i32;
        fn SetForegroundWindow(hwnd: *mut c_void) -> i32;
        fn IsIconic(hwnd: *mut c_void) -> i32;
    }

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        if IsIconic(hwnd.0) != 0 {
            ShowWindow(hwnd.0, SW_RESTORE);
        }
        ShowWindow(hwnd.0, SW_SHOW);
        SetForegroundWindow(hwnd.0);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn force_foreground(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
pub fn is_iconic(window: &tauri::WebviewWindow) -> bool {
    use std::ffi::c_void;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn IsIconic(hwnd: *mut c_void) -> i32;
    }
    match window.hwnd() {
        Ok(hwnd) => unsafe { IsIconic(hwnd.0) != 0 },
        Err(_) => false,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn is_iconic(_window: &tauri::WebviewWindow) -> bool {
    false
}
