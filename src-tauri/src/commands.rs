use crate::db;
use crate::models::{BackupInfo, Changes, Edge, Node, Snapshot};
use crate::AppDb;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::{Manager, State};

/// The marker every export carries. A file without it is not ours, and is
/// refused rather than parsed leniently (D022-safe: the front end gets a key).
const EXPORT_FORMAT: &str = "thoughttree.export";

/// The on-disk shape of an exported file. `export_data` serialises it and
/// `read_import` deserialises the *same* struct, so the two can never drift.
///
/// Only `format` is required on the way in: it is the marker that says the file
/// is ours. The remaining fields fall back to sensible defaults so a hand-edited
/// export that dropped the metadata is still importable.
#[derive(Debug, Serialize, Deserialize)]
struct ExportFile {
    #[serde(default)]
    app: String,
    format: String,
    #[serde(default)]
    version: i64,
    #[serde(default)]
    exported_at: i64,
    #[serde(default)]
    nodes: Vec<Node>,
    #[serde(default)]
    edges: Vec<Edge>,
}

#[tauri::command]
pub fn db_load(state: State<'_, AppDb>) -> Result<Snapshot, String> {
    state.with(|conn| db::load(conn).map_err(|e| e.to_string()))
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
    state.with_mut(|conn| db::apply(conn, &changes).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn settings_all(state: State<'_, AppDb>) -> Result<HashMap<String, String>, String> {
    state.with(|conn| {
        let rows = db::all_settings(conn).map_err(|e| e.to_string())?;
        Ok(rows.into_iter().collect())
    })
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppDb>, key: String, value: String) -> Result<(), String> {
    state.with(|conn| db::set_setting(conn, &key, &value).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

fn snapshot_json(state: &State<'_, AppDb>, pretty: bool) -> Result<String, String> {
    state.with(|conn| {
        let snapshot = db::load(conn).map_err(|e| e.to_string())?;
        let payload = ExportFile {
            app: "ThoughtTree".to_string(),
            format: EXPORT_FORMAT.to_string(),
            version: 2,
            exported_at: db::now_ms(),
            nodes: snapshot.nodes,
            edges: snapshot.edges,
        };
        if pretty {
            serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())
        } else {
            serde_json::to_string(&payload).map_err(|e| e.to_string())
        }
    })
}

#[tauri::command]
pub fn export_data(state: State<'_, AppDb>, path: String) -> Result<String, String> {
    let serialized = snapshot_json(&state, true)?;
    std::fs::write(&path, serialized).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Reads an exported file back into memory. Strictly read-only: importing is a
/// normal, undoable changeset built on the front end, so this must not touch the
/// database. A file that is not a ThoughtTree export comes back as the
/// `error.importFormat` key, never as display text.
#[tauri::command]
pub fn read_import(path: String) -> Result<Snapshot, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: ExportFile =
        serde_json::from_str(&raw).map_err(|_| "error.importFormat".to_string())?;
    if parsed.format != EXPORT_FORMAT {
        return Err("error.importFormat".to_string());
    }
    Ok(Snapshot {
        nodes: parsed.nodes,
        edges: parsed.edges,
    })
}

#[tauri::command]
pub fn create_backup(state: State<'_, AppDb>, path: String) -> Result<String, String> {
    let serialized = snapshot_json(&state, false)?;
    std::fs::write(&path, serialized).map_err(|e| e.to_string())?;
    Ok(path)
}

/// The rotating `.db` snapshots written by `backup_rotate`, newest first.
#[tauri::command]
pub fn list_backups(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(db::list_backups(&data_dir.join("backups")))
}

/// Replaces the whole database with a chosen snapshot and returns the restored
/// graph. The live file is safety-copied into `backups/` first, so a restore is
/// itself recoverable. This is the one action that is deliberately not a
/// reversible `Mutation` (see DECISIONS.md, D029).
#[tauri::command]
pub fn restore_backup(
    app: tauri::AppHandle,
    state: State<'_, AppDb>,
    path: String,
) -> Result<Snapshot, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = data_dir.join("thoughttree.db");
    let backup_dir = data_dir.join("backups");
    state.reopen(&db_path, || {
        db::restore_files(&db_path, Path::new(&path), &backup_dir)
    })
}
