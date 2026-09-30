//! Browser awareness for the capture sampler.
//!
//! Two jobs:
//!
//! * [`is_browser`] — a cheap, name-based pre-filter so the expensive UI
//!   Automation probe below only ever runs for a window that might be a browser.
//! * [`AddressBarReader`] — reads the focused tab's address straight out of a
//!   Chromium/Firefox address bar through Windows UI Automation. This is fully
//!   offline: nothing leaves the machine.
//!
//! Electron apps (Feishu, markdown editors, …) reuse the same window classes and
//! the same accessibility tree shape as Chromium, so the executable name is only
//! a hint — the omnibox probe is what actually decides.

/// Executables that are a real browser (case-insensitive stem, `.exe` optional).
pub fn is_browser(app: &str) -> bool {
    let lower = app.trim().to_ascii_lowercase();
    let stem = lower.strip_suffix(".exe").unwrap_or(lower.as_str());
    matches!(
        stem,
        "chrome" | "msedge" | "firefox" | "brave" | "opera" | "vivaldi" | "chromium"
    )
}

/// Turns a recorded page into something `ShellExecuteW` can open, or `None`.
///
/// Chromium **hides the scheme** in the omnibox, so a page captured from a
/// browser usually looks like `example.com/path` with no scheme at all — for a
/// while this function rejected exactly that, and so rejected every real URL it
/// was ever handed. `https://` is now assumed for a value that carries no
/// scheme.
///
/// A value that *does* carry one must be `http` or `https`. That is what keeps
/// `open_url` — which is driven by the front end — from becoming a launcher for
/// `file:`, `javascript:`, `ms-settings:` or any other protocol handler.
pub fn resolve_open_target(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }

    match scheme_of(&trimmed.to_ascii_lowercase()) {
        Some("http") | Some("https") => Some(trimmed.to_string()),
        Some(_) => None,
        None => Some(format!("https://{trimmed}")),
    }
}

/// The scheme of a lowercase URL, or `None` when it has none.
///
/// `example.com:8080/x` must not be read as the scheme `example.com`: digits
/// straight after the colon mean a port, and the value is really scheme-less.
fn scheme_of(lower: &str) -> Option<&str> {
    let colon = lower.find(':')?;
    let (before, after) = lower.split_at(colon);
    let after = after.get(1..)?;

    if before.is_empty()
        || !before.starts_with(|c: char| c.is_ascii_alphabetic())
        || !before
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.')
    {
        return None;
    }
    if after.starts_with(|c: char| c.is_ascii_digit()) {
        return None;
    }
    Some(before)
}

#[cfg(target_os = "windows")]
mod imp {
    use windows::core::BSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationCondition, IUIAutomationElement,
        IUIAutomationValuePattern, TreeScope_Descendants, UIA_AutomationIdPropertyId,
        UIA_ClassNamePropertyId, UIA_ValuePatternId,
    };

    /// Chromium (Chrome/Edge/Brave/…) exposes the address bar as an element with
    /// this class name. Its automation id is a per-session `view_1012` and its
    /// name is localised, so the class name is the only stable handle.
    const OMNIBOX_CLASS: &str = "OmniboxViewViews";

    /// Firefox names its address bar this, which is stable across locales.
    const FIREFOX_ID: &str = "urlbar-input";

    /// Reads a browser's address bar through UI Automation.
    ///
    /// The COM object and the two property conditions are built once in [`new`]
    /// and reused: creating them per call is needless, and the `IUIAutomation`
    /// instance is apartment-bound, so the reader has to stay on the thread that
    /// created it.
    ///
    /// [`new`]: AddressBarReader::new
    pub struct AddressBarReader {
        automation: IUIAutomation,
        class_condition: IUIAutomationCondition,
        id_condition: IUIAutomationCondition,
    }

    impl AddressBarReader {
        /// Initialises COM on the calling thread (once) and builds the reader.
        /// Returns `None` on any failure — this never panics.
        pub fn new() -> Option<Self> {
            // S_FALSE simply means COM was already initialised on this thread,
            // so the result is deliberately ignored.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let automation: IUIAutomation =
                    CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
                let class_condition = automation
                    .CreatePropertyCondition(UIA_ClassNamePropertyId, &VARIANT::from(OMNIBOX_CLASS))
                    .ok()?;
                let id_condition = automation
                    .CreatePropertyCondition(UIA_AutomationIdPropertyId, &VARIANT::from(FIREFOX_ID))
                    .ok()?;
                Some(Self {
                    automation,
                    class_condition,
                    id_condition,
                })
            }
        }

        /// The focused tab's address (Chromium strips the scheme) or `None`.
        pub fn read(&self, hwnd: HWND) -> Option<String> {
            unsafe {
                let element = self.automation.ElementFromHandle(hwnd).ok()?;
                self.value_for(&element, &self.class_condition)
                    .or_else(|| self.value_for(&element, &self.id_condition))
            }
        }

        /// First descendant matching `condition` whose value pattern holds a
        /// non-empty string. `FindFirst` returns `Err` when nothing matches,
        /// which is the normal "not a browser" path.
        unsafe fn value_for(
            &self,
            element: &IUIAutomationElement,
            condition: &IUIAutomationCondition,
        ) -> Option<String> {
            let target = element.FindFirst(TreeScope_Descendants, condition).ok()?;
            let pattern: IUIAutomationValuePattern =
                target.GetCurrentPatternAs(UIA_ValuePatternId).ok()?;
            let value: BSTR = pattern.CurrentValue().ok()?;
            let text = value.to_string();
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::AddressBarReader;

/// Opens `url` in the user's default browser via `ShellExecuteW`.
///
/// The caller must have validated the scheme (see [`is_allowed_url`]); this only
/// performs the launch.
#[cfg(target_os = "windows")]
pub fn open_url(url: &str) -> Result<(), String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let target = HSTRING::from(url);
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR::null(),
            &target,
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW reports failure with a result <= 32.
    if result.0 as isize <= 32 {
        return Err("error.openUrlFailed".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn open_url(_url: &str) -> Result<(), String> {
    Err("error.unsupported".to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_browser, resolve_open_target};

    fn target(url: &str) -> Option<String> {
        resolve_open_target(url)
    }

    #[test]
    fn is_browser_recognizes_real_browsers_case_insensitively() {
        assert!(is_browser("chrome"));
        assert!(is_browser("Chrome"));
        assert!(is_browser("MSEDGE"));
        assert!(is_browser("msedge.exe"));
        assert!(is_browser("firefox"));
        assert!(is_browser("Brave"));
        assert!(is_browser("chromium"));
        assert!(is_browser("opera"));
        assert!(is_browser("vivaldi"));
    }

    #[test]
    fn is_browser_rejects_electron_and_other_apps() {
        assert!(!is_browser("feishu"));
        assert!(!is_browser("notepad"));
        assert!(!is_browser("code"));
        assert!(!is_browser(""));
        assert!(!is_browser("chrome-helper"));
    }

    #[test]
    fn a_scheme_less_value_gets_https() {
        // What Chromium's omnibox actually hands us.
        assert_eq!(
            target("jieni.ai/docs/reading/how-to-be-good-at-research").as_deref(),
            Some("https://jieni.ai/docs/reading/how-to-be-good-at-research"),
        );
        assert_eq!(
            target("datawhalechina.github.io/diy-llm/").as_deref(),
            Some("https://datawhalechina.github.io/diy-llm/"),
        );
        assert_eq!(target("example.com").as_deref(), Some("https://example.com"));
    }

    #[test]
    fn an_explicit_web_scheme_is_kept() {
        assert_eq!(target("http://example.com").as_deref(), Some("http://example.com"));
        assert_eq!(target("HTTPS://Example.com").as_deref(), Some("HTTPS://Example.com"));
        assert_eq!(
            target("  https://example.com  ").as_deref(),
            Some("https://example.com"),
        );
    }

    #[test]
    fn a_port_is_not_mistaken_for_a_scheme() {
        assert_eq!(target("example.com:8080/x").as_deref(), Some("https://example.com:8080/x"));
        assert_eq!(target("localhost:3000").as_deref(), Some("https://localhost:3000"));
        assert_eq!(target("127.0.0.1:5173/x").as_deref(), Some("https://127.0.0.1:5173/x"));
    }

    /// Not part of the normal run: it opens a real browser window. Kept because
    /// "the guard accepts the URL" is a weaker claim than "the page opens".
    #[test]
    #[ignore = "launches the default browser; run with: cargo test -- --ignored"]
    #[cfg(target_os = "windows")]
    fn shell_execute_actually_opens_the_page() {
        let target = resolve_open_target("datawhalechina.github.io/diy-llm/").unwrap();
        assert_eq!(target, "https://datawhalechina.github.io/diy-llm/");
        super::open_url(&target).expect("ShellExecuteW should open the page");
    }

    #[test]
    fn other_protocol_handlers_are_refused() {
        assert_eq!(target("file:///C:/Windows/System32/cmd.exe"), None);
        assert_eq!(target("javascript:alert(1)"), None);
        assert_eq!(target("data:text/html,<script>x</script>"), None);
        assert_eq!(target("ms-settings:"), None);
        assert_eq!(target("vbscript:msgbox(1)"), None);
        assert_eq!(target("ftp://example.com"), None);
        assert_eq!(target(r"C:\Windows\notepad.exe"), None);
        assert_eq!(target("chrome://settings"), None);
        assert_eq!(target(""), None);
        assert_eq!(target("   "), None);
    }
}
