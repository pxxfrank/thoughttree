mod commands;
mod context;
mod db;
mod models;
mod platform;
mod tray;
mod windows;

use crate::models::Snapshot;
use std::path::Path;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};
use windows::OrbState;

/// The database handle.
///
/// The connection is optional so that a database which cannot be opened reports
/// *why*, instead of leaving every command to fail with "state not managed".
pub struct AppDb {
    pub connection: Mutex<Option<rusqlite::Connection>>,
    pub open_error: Option<String>,
}

impl AppDb {
    pub fn open(path: &Path) -> Self {
        match db::open(path) {
            Ok(connection) => AppDb {
                connection: Mutex::new(Some(connection)),
                open_error: None,
            },
            Err(error) => AppDb {
                connection: Mutex::new(None),
                open_error: Some(error.to_string()),
            },
        }
    }

    pub fn with<T>(
        &self,
        run: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        if let Some(error) = &self.open_error {
            return Err(format!("the local database could not be opened: {error}"));
        }
        let guard = self.connection.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(connection) => run(connection),
            None => Err("the local database is not available".to_string()),
        }
    }

    pub fn with_mut<T>(
        &self,
        run: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        if let Some(error) = &self.open_error {
            return Err(format!("the local database could not be opened: {error}"));
        }
        let mut guard = self.connection.lock().map_err(|e| e.to_string())?;
        match guard.as_mut() {
            Some(connection) => run(connection),
            None => Err("the local database is not available".to_string()),
        }
    }

    /// Closes the live connection, runs `swap` (which replaces the database file
    /// on disk), then reopens from `db_path` and returns the fresh snapshot.
    ///
    /// The connection lives inside the mutex, so taking the lock *is* closing
    /// it: `swap` runs with no open SQLite handle, over a `None` slot. Nothing
    /// inside `swap` acquires a lock, so holding the guard across the file copy
    /// cannot deadlock — it only stops a second writer from slipping in mid-swap.
    pub fn reopen(
        &self,
        db_path: &Path,
        swap: impl FnOnce() -> Result<(), String>,
    ) -> Result<Snapshot, String> {
        if let Some(error) = &self.open_error {
            return Err(format!("the local database could not be opened: {error}"));
        }
        let mut guard = self.connection.lock().map_err(|e| e.to_string())?;
        if let Some(connection) = guard.as_ref() {
            db::checkpoint(connection).map_err(|e| e.to_string())?;
        }
        *guard = None;
        swap()?;
        let connection = db::open(db_path).map_err(|e| e.to_string())?;
        let snapshot = db::load(&connection).map_err(|e| e.to_string())?;
        *guard = Some(connection);
        Ok(snapshot)
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let db_path = data_dir.join("thoughttree.db");

            // Manage the database *before* creating any window that talks to it.
            // A packaged front end boots from embedded assets and fires `db_load`
            // within milliseconds — faster than a window declared in
            // tauri.conf.json, which is built before this hook even runs.
            let db = AppDb::open(&db_path);

            // Back up *after* opening, on the live connection, so the copy can be
            // checkpointed first: at launch the WAL still holds the whole previous
            // session, and copying the file without folding it in would silently
            // drop everything the user wrote last time.
            let _ = db.with(|conn| {
                db::backup_rotate(conn, &db_path, &data_dir.join("backups"), 5);
                Ok(())
            });
            app.manage(db);
            app.manage(OrbState::default());
            app.manage(context::ContextSlot::default());

            // All three windows are created here, in order, rather than in the
            // config: config windows are built before this hook runs, and the
            // orb (created first) never composited when the others were built
            // later by Tauri.
            windows::create_orb_window(app)?;
            windows::create_main_window(app)?;
            windows::create_capture_window(app)?;

            let accel = windows::current_shortcut_accel(&handle);
            if let Err(err) = windows::register_shortcut(&handle, &accel) {
                eprintln!("[thoughttree] could not register shortcut '{accel}': {err}");
            }
            windows::restore_orb(&handle);
            windows::show_main(&handle);
            windows::watch_main_window(handle.clone());
            context::start(&handle);
            if let Err(error) = tray::install(app) {
                eprintln!("[thoughttree] could not create the tray icon: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // Closing the main or capture window must not kill the app: the
                // orb and the global shortcut keep working in the background.
                WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "main" || window.label() == "capture" {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_load,
            commands::db_apply,
            commands::settings_all,
            commands::settings_set,
            commands::data_dir,
            commands::export_data,
            commands::create_backup,
            commands::read_import,
            commands::list_backups,
            commands::restore_backup,
            windows::open_capture_window,
            windows::hide_capture_window,
            windows::show_main_window,
            windows::hide_main_window,
            windows::quit_app,
            windows::orb_snap_window,
            windows::orb_peek_window,
            windows::orb_expand_window,
            windows::set_app_theme,
            windows::fit_main_to_screen,
            windows::capture_source_context,
            windows::set_shortcut,
            windows::shortcut_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ThoughtTree");
}
