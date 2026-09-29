mod commands;
mod db;
mod models;
mod platform;
mod tray;
mod windows;

use std::sync::Mutex;
use tauri::{Manager, WindowEvent};
use windows::OrbState;

pub struct AppDb(pub Mutex<rusqlite::Connection>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let db_path = data_dir.join("thoughttree.db");
            db::backup_rotate(&db_path, &data_dir.join("backups"), 5);

            let conn = db::open(&db_path)?;
            app.manage(AppDb(Mutex::new(conn)));
            app.manage(OrbState::default());

            let accel = windows::current_shortcut_accel(&handle);
            if let Err(err) = windows::register_shortcut(&handle, &accel) {
                eprintln!("[thoughttree] could not register shortcut '{accel}': {err}");
            }
            windows::restore_orb(&handle);
            // Make sure the main window is genuinely visible and in front: the
            // first ShowWindow of a process is replaced by whatever it was
            // launched with (a hidden console, a "minimized" shortcut, a
            // scheduled task).
            windows::show_main(&handle);
            windows::watch_main_window(handle.clone());
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
            windows::open_capture_window,
            windows::hide_capture_window,
            windows::show_main_window,
            windows::hide_main_window,
            windows::quit_app,
            windows::orb_snap_window,
            windows::orb_peek_window,
            windows::orb_expand_window,
            windows::capture_source_context,
            windows::set_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ThoughtTree");
}
