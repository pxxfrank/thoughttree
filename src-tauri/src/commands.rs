use crate::{db, AppDb};
use crate::models::{Changes, Snapshot};
use serde_json::json;
use std::collections::HashMap;
use tauri::{Manager, State};

#[tauri::command]
pub fn db_load(state: State<'_, AppDb>) -> Result<Snapshot, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::load(&conn).map_err(|e| e.to_string())
}

/// The one and only write path. Local-first: the UI updates optimistically and
/// hands the resulting changeset here, which lands in a single transaction.
#[tauri::command]
pub fn db_apply(state: State<'_, AppDb>, changes: Changes) -> Result<(), String> {
    if changes.upsert_nodes.is_empty()
        && changes.upsert_edges.is_empty()
        && changes.delete_nodes.is_empty()
        && changes.delete_edges.is_empty()
    {
        return Ok(());
    }
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    db::apply(&mut conn, &changes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_all(state: State<'_, AppDb>) -> Result<HashMap<String, String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let rows = db::all_settings(&conn).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().collect())
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppDb>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_data(state: State<'_, AppDb>, path: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let snapshot = db::load(&conn).map_err(|e| e.to_string())?;
    let payload = json!({
        "app": "ThoughtTree",
        "format": "thoughttree.export",
        "version": 1,
        "exported_at": db::now_ms(),
        "nodes": snapshot.nodes,
        "edges": snapshot.edges,
    });
    let serialized = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    std::fs::write(&path, serialized).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
pub fn create_backup(state: State<'_, AppDb>, path: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let snapshot = db::load(&conn).map_err(|e| e.to_string())?;
    let payload = json!({
        "app": "ThoughtTree",
        "format": "thoughttree.export",
        "version": 1,
        "exported_at": db::now_ms(),
        "nodes": snapshot.nodes,
        "edges": snapshot.edges,
    });
    let serialized = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    std::fs::write(&path, serialized).map_err(|e| e.to_string())?;
    Ok(path)
}
