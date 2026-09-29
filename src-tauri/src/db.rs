use crate::models::{BackupInfo, Changes, Edge, Node, Snapshot};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: i32 = 2;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,
  text          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'normal',
  status        TEXT NOT NULL DEFAULT 'open',
  parent_id     TEXT,
  position      REAL NOT NULL DEFAULT 0,
  note          TEXT,
  conclusion    TEXT,
  inbox         INTEGER NOT NULL DEFAULT 0,
  collapsed     INTEGER NOT NULL DEFAULT 0,
  source_app    TEXT,
  source_title  TEXT
);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_inbox ON nodes(inbox);

CREATE TABLE IF NOT EXISTS edges (
  id            TEXT PRIMARY KEY,
  from_node     TEXT NOT NULL,
  to_node       TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'decompose',
  reason        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

/// v2 introduces the `kind` discriminator on `edges`. A 'parent' edge is the
/// tree link, of which a child has at most one; a 'link' edge is a cross-branch
/// relation and is unconstrained. What used to be a blanket unique index on
/// `to_node` becomes a *partial* index scoped to parent edges, which is exactly
/// what the discriminator is for.
///
/// It runs as a separate step so a database created by v1 takes the ALTER path
/// rather than being recreated.
const SCHEMA_V2: &str = r#"
ALTER TABLE edges ADD COLUMN kind TEXT NOT NULL DEFAULT 'parent';
DROP INDEX IF EXISTS idx_edges_to;
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_node) WHERE kind = 'parent';
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_link ON edges(from_node, to_node, relation_type) WHERE kind = 'link';
CREATE INDEX IF NOT EXISTS idx_edges_kind_from ON edges(kind, from_node);
CREATE INDEX IF NOT EXISTS idx_edges_kind_to   ON edges(kind, to_node);
"#;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Opens (or creates) the database and brings the schema up to date.
/// WAL + `synchronous=NORMAL` gives durable writes without fsync-per-statement
/// stalls, which is what keeps capture feel instant.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
    }
    if version < 2 {
        conn.execute_batch(SCHEMA_V2)?;
    }
    if version < SCHEMA_VERSION {
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }
    Ok(())
}

const NODE_COLUMNS: &str = "id, text, created_at, updated_at, priority, status, parent_id, position, note, conclusion, inbox, collapsed, source_app, source_title";

fn read_node(row: &rusqlite::Row<'_>) -> rusqlite::Result<Node> {
    Ok(Node {
        id: row.get(0)?,
        text: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        priority: row.get(4)?,
        status: row.get(5)?,
        parent_id: row.get(6)?,
        position: row.get(7)?,
        note: row.get(8)?,
        conclusion: row.get(9)?,
        inbox: row.get(10)?,
        collapsed: row.get(11)?,
        source_app: row.get(12)?,
        source_title: row.get(13)?,
    })
}

pub fn load(conn: &Connection) -> rusqlite::Result<Snapshot> {
    let mut node_stmt = conn.prepare(&format!("SELECT {NODE_COLUMNS} FROM nodes"))?;
    let nodes = node_stmt
        .query_map([], read_node)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut edge_stmt = conn.prepare(
        "SELECT id, from_node, to_node, relation_type, reason, created_at, kind FROM edges",
    )?;
    let edges = edge_stmt
        .query_map([], |row| {
            Ok(Edge {
                id: row.get(0)?,
                from_node: row.get(1)?,
                to_node: row.get(2)?,
                relation_type: row.get(3)?,
                reason: row.get(4)?,
                created_at: row.get(5)?,
                kind: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Snapshot { nodes, edges })
}

/// Applies a changeset atomically. Deleting a node also removes any edge that
/// references it, so the store can never end up with dangling relations.
pub fn apply(conn: &mut Connection, changes: &Changes) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        {
            let mut del_node = tx.prepare("DELETE FROM nodes WHERE id = ?1")?;
            let mut del_edge = tx.prepare("DELETE FROM edges WHERE id = ?1")?;
            let mut del_edge_ref =
                tx.prepare("DELETE FROM edges WHERE from_node = ?1 OR to_node = ?1")?;
            for id in &changes.delete_nodes {
                del_node.execute(params![id])?;
                del_edge_ref.execute(params![id])?;
            }
            for id in &changes.delete_edges {
                del_edge.execute(params![id])?;
            }
        }
        {
            // A node has at most one incoming *parent* edge; drop any stale
            // parent edge for the same child before writing the new one. A link
            // is exempt, so it never displaces a parent edge that happens to
            // share its `to_node`.
            let mut clear_edge =
                tx.prepare("DELETE FROM edges WHERE to_node = ?1 AND id <> ?2 AND kind = 'parent'")?;
            let mut up_edge = tx.prepare(
                "INSERT INTO edges (id, from_node, to_node, relation_type, reason, created_at, kind)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                   from_node = excluded.from_node,
                   to_node = excluded.to_node,
                   relation_type = excluded.relation_type,
                   reason = excluded.reason,
                   kind = excluded.kind",
            )?;
            for e in &changes.upsert_edges {
                clear_edge.execute(params![e.to_node, e.id])?;
                up_edge.execute(params![
                    e.id,
                    e.from_node,
                    e.to_node,
                    e.relation_type,
                    e.reason,
                    e.created_at,
                    e.kind
                ])?;
            }
        }
        {
            let mut up_node = tx.prepare(
                "INSERT INTO nodes (id, text, created_at, updated_at, priority, status, parent_id,
                                    position, note, conclusion, inbox, collapsed, source_app, source_title)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(id) DO UPDATE SET
                   text = excluded.text,
                   updated_at = excluded.updated_at,
                   priority = excluded.priority,
                   status = excluded.status,
                   parent_id = excluded.parent_id,
                   position = excluded.position,
                   note = excluded.note,
                   conclusion = excluded.conclusion,
                   inbox = excluded.inbox,
                   collapsed = excluded.collapsed,
                   source_app = excluded.source_app,
                   source_title = excluded.source_title",
            )?;
            for n in &changes.upsert_nodes {
                up_node.execute(params![
                    n.id,
                    n.text,
                    n.created_at,
                    n.updated_at,
                    n.priority,
                    n.status,
                    n.parent_id,
                    n.position,
                    n.note,
                    n.conclusion,
                    n.inbox,
                    n.collapsed,
                    n.source_app,
                    n.source_title,
                ])?;
            }
        }
    }
    tx.commit()
}

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| {
        r.get(0)
    })
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

pub fn all_settings(conn: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Folds the write-ahead log back into the main database file.
///
/// The WAL holds every commit since the last checkpoint, so anything that copies
/// `thoughttree.db` without running this first can silently drop the most recent
/// session — exactly the rows a backup exists to protect.
pub fn checkpoint(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
}

/// Keeps the `keep` most recent database snapshots so a crash or a bad edit
/// never costs more than one session.
///
/// The connection is passed in so the WAL is checkpointed onto the main file
/// *before* it is copied: at launch that WAL still holds the whole previous
/// session, and a raw file copy would otherwise miss it.
pub fn backup_rotate(conn: &Connection, db_path: &Path, backup_dir: &Path, keep: usize) {
    if !db_path.exists() {
        return;
    }
    let _ = checkpoint(conn);
    if std::fs::create_dir_all(backup_dir).is_err() {
        return;
    }
    let stamp = now_ms();
    let target = backup_dir.join(format!("thoughttree-{stamp}.db"));
    if std::fs::copy(db_path, &target).is_err() {
        return;
    }
    let mut backups: Vec<PathBuf> = std::fs::read_dir(backup_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.extension().map(|x| x == "db").unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    if backups.len() <= keep {
        return;
    }
    backups.sort();
    let excess = backups.len() - keep;
    for path in backups.into_iter().take(excess) {
        let _ = std::fs::remove_file(path);
    }
}

/// The timestamp encoded in a `thoughttree-<stamp>[-suffix].db` name, falling
/// back to the file's modified time when the name does not carry one.
fn created_at_of(name: &str, path: &Path) -> i64 {
    let stem = name.strip_suffix(".db").unwrap_or(name);
    let digits: String = stem
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if let Ok(stamp) = digits.parse::<i64>() {
        return stamp;
    }
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Lists the `.db` snapshots in `backup_dir`, newest first.
pub fn list_backups(backup_dir: &Path) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = std::fs::read_dir(backup_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|x| x == "db").unwrap_or(false))
                .filter_map(|e| {
                    let path = e.path();
                    let name = path.file_name()?.to_string_lossy().to_string();
                    let size = e.metadata().ok()?.len();
                    Some(BackupInfo {
                        created_at: created_at_of(&name, &path),
                        name,
                        path: path.to_string_lossy().to_string(),
                        size,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

/// The file-level half of a restore: copy the live database aside so the swap is
/// itself recoverable, overwrite it with `backup_path`, and drop any stale
/// `-wal`/`-shm` left beside it (a WAL from the *replaced* file would corrupt
/// the swap). The caller must have already closed the live connection; the
/// database is reopened by the caller afterwards.
pub fn restore_files(db_path: &Path, backup_path: &Path, backup_dir: &Path) -> Result<(), String> {
    if db_path.exists() {
        std::fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;
        let stamp = now_ms();
        let safety = backup_dir.join(format!("thoughttree-{stamp}-prerestore.db"));
        std::fs::copy(db_path, &safety).map_err(|e| e.to_string())?;
    }
    std::fs::copy(backup_path, db_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
    let _ = std::fs::remove_file(db_path.with_extension("db-shm"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Node;

    fn node(id: &str, parent: Option<&str>, inbox: bool) -> Node {
        Node {
            id: id.to_string(),
            text: format!("node {id}"),
            created_at: 1,
            updated_at: 1,
            priority: "normal".to_string(),
            status: "open".to_string(),
            parent_id: parent.map(|s| s.to_string()),
            position: 1.0,
            note: None,
            conclusion: None,
            inbox,
            collapsed: false,
            source_app: None,
            source_title: None,
        }
    }

    fn edge(id: &str, from: &str, to: &str) -> Edge {
        Edge {
            id: id.to_string(),
            from_node: from.to_string(),
            to_node: to.to_string(),
            relation_type: "decompose".to_string(),
            reason: None,
            created_at: 1,
            kind: "parent".to_string(),
        }
    }

    fn link(id: &str, from: &str, to: &str, relation_type: &str) -> Edge {
        Edge {
            id: id.to_string(),
            from_node: from.to_string(),
            to_node: to.to_string(),
            relation_type: relation_type.to_string(),
            reason: None,
            created_at: 1,
            kind: "link".to_string(),
        }
    }

    #[test]
    fn creates_and_reads_nodes() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![node("a", None, true)],
                ..Default::default()
            },
        )
        .unwrap();
        let snap = load(&conn).unwrap();
        assert_eq!(snap.nodes.len(), 1);
        assert!(snap.nodes[0].inbox);
        assert_eq!(snap.nodes[0].text, "node a");
    }

    #[test]
    fn upsert_updates_existing_node() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![node("a", None, true)],
                ..Default::default()
            },
        )
        .unwrap();
        let mut updated = node("a", Some("p"), false);
        updated.text = "renamed".to_string();
        updated.status = "done".to_string();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![updated],
                ..Default::default()
            },
        )
        .unwrap();
        let snap = load(&conn).unwrap();
        assert_eq!(snap.nodes.len(), 1);
        assert_eq!(snap.nodes[0].text, "renamed");
        assert_eq!(snap.nodes[0].status, "done");
        assert_eq!(snap.nodes[0].parent_id.as_deref(), Some("p"));
        assert!(!snap.nodes[0].inbox);
    }

    #[test]
    fn deleting_a_node_cascades_to_edges() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![node("a", None, false), node("b", Some("a"), false)],
                upsert_edges: vec![edge("e1", "a", "b")],
                ..Default::default()
            },
        )
        .unwrap();
        apply(
            &mut conn,
            &Changes {
                delete_nodes: vec!["b".to_string()],
                ..Default::default()
            },
        )
        .unwrap();
        let snap = load(&conn).unwrap();
        assert_eq!(snap.nodes.len(), 1);
        assert!(snap.edges.is_empty());
    }

    #[test]
    fn one_edge_per_child_even_when_reparented() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![node("a", None, false), node("b", None, false)],
                upsert_edges: vec![edge("e1", "a", "b")],
                ..Default::default()
            },
        )
        .unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_edges: vec![edge("e2", "b", "a")],
                ..Default::default()
            },
        )
        .unwrap();
        let snap = load(&conn).unwrap();
        assert_eq!(snap.edges.len(), 2);
        let a_edge = snap.edges.iter().find(|e| e.to_node == "a").unwrap();
        assert_eq!(a_edge.from_node, "b");
    }

    // --- Feature 3: cross-branch links ----------------------------------

    #[test]
    fn link_round_trips_its_kind() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![node("a", None, false), node("b", None, false)],
                upsert_edges: vec![link("l1", "a", "b", "challenge")],
                ..Default::default()
            },
        )
        .unwrap();
        let snap = load(&conn).unwrap();
        assert_eq!(snap.edges.len(), 1);
        assert_eq!(snap.edges[0].kind, "link");
        assert_eq!(snap.edges[0].relation_type, "challenge");
    }

    #[test]
    fn two_parent_edges_for_one_child_collapse_to_one() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![
                    node("a", None, false),
                    node("c", None, false),
                    node("b", None, false),
                ],
                upsert_edges: vec![edge("e1", "a", "b")],
                ..Default::default()
            },
        )
        .unwrap();
        // A second parent edge for the same child displaces the first.
        apply(
            &mut conn,
            &Changes {
                upsert_edges: vec![edge("e2", "c", "b")],
                ..Default::default()
            },
        )
        .unwrap();
        let snap = load(&conn).unwrap();
        let into_b: Vec<_> = snap.edges.iter().filter(|e| e.to_node == "b").collect();
        assert_eq!(into_b.len(), 1);
        assert_eq!(into_b[0].from_node, "c");
    }

    #[test]
    fn partial_index_allows_many_links_into_one_node() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![
                    node("a", None, false),
                    node("b", None, false),
                    node("c", None, false),
                    node("d", None, false),
                ],
                upsert_edges: vec![
                    link("l1", "a", "d", "support"),
                    link("l2", "b", "d", "challenge"),
                    link("l3", "c", "d", "depends_on"),
                ],
                ..Default::default()
            },
        )
        .unwrap();
        let snap = load(&conn).unwrap();
        let into_d: Vec<_> = snap.edges.iter().filter(|e| e.to_node == "d").collect();
        assert_eq!(into_d.len(), 3);
        assert!(into_d.iter().all(|e| e.kind == "link"));
    }

    #[test]
    fn duplicate_link_is_rejected() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![node("a", None, false), node("b", None, false)],
                upsert_edges: vec![link("l1", "a", "b", "support")],
                ..Default::default()
            },
        )
        .unwrap();
        // Same (from, to, type) with a different id violates the partial unique
        // index; a plain `apply` error means the transaction rolled back.
        let result = apply(
            &mut conn,
            &Changes {
                upsert_edges: vec![link("l2", "a", "b", "support")],
                ..Default::default()
            },
        );
        assert!(result.is_err());
        let snap = load(&conn).unwrap();
        assert_eq!(snap.edges.len(), 1);
    }

    #[test]
    fn deleting_a_node_cascades_to_its_links() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![node("a", None, false), node("b", None, false)],
                upsert_edges: vec![link("l1", "a", "b", "challenge")],
                ..Default::default()
            },
        )
        .unwrap();
        apply(
            &mut conn,
            &Changes {
                delete_nodes: vec!["b".to_string()],
                ..Default::default()
            },
        )
        .unwrap();
        let snap = load(&conn).unwrap();
        assert_eq!(snap.nodes.len(), 1);
        assert!(snap.edges.is_empty());
    }

    #[test]
    fn v1_database_migrates_to_v2_and_keeps_parent_edges() {
        let dir = temp_dir("migrate-v1");
        let db_path = dir.join("v1.db");

        // Build a database that only knows schema v1: no `kind` column, a
        // blanket unique index on `to_node`, and `user_version = 1`.
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(SCHEMA_V1).unwrap();
            conn.pragma_update(None, "user_version", 1).unwrap();
            for id in ["a", "b"] {
                conn.execute(
                    "INSERT INTO nodes (id, text, created_at, updated_at) VALUES (?1, ?2, 1, 1)",
                    params![id, format!("node {id}")],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO edges (id, from_node, to_node, relation_type, reason, created_at)
                 VALUES ('e1', 'a', 'b', 'decompose', NULL, 1)",
                [],
            )
            .unwrap();
        }

        // Opening runs the migration.
        let conn = open(&db_path).unwrap();
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 2);

        let snap = load(&conn).unwrap();
        assert_eq!(snap.edges.len(), 1);
        assert_eq!(snap.edges[0].id, "e1");
        assert_eq!(snap.edges[0].kind, "parent");

        // The migrated schema accepts links: several into one node, all 'link'.
        drop(conn);
        let mut conn = open(&db_path).unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_edges: vec![link("l1", "b", "a", "support")],
                ..Default::default()
            },
        )
        .unwrap();
        let snap = load(&conn).unwrap();
        assert_eq!(snap.edges.len(), 2);
        assert_eq!(snap.edges.iter().filter(|e| e.kind == "link").count(), 1);
    }

    #[test]
    fn settings_round_trip() {
        let conn = open_in_memory().unwrap();
        assert_eq!(get_setting(&conn, "shortcut").unwrap(), None);
        set_setting(&conn, "shortcut", "Alt+Space").unwrap();
        set_setting(&conn, "shortcut", "Ctrl+Alt+K").unwrap();
        assert_eq!(
            get_setting(&conn, "shortcut").unwrap().as_deref(),
            Some("Ctrl+Alt+K")
        );
        assert_eq!(all_settings(&conn).unwrap().len(), 1);
    }

    // --- Feature 5: import + restore ------------------------------------

    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::commands::read_import;

    static TEST_DIR_SEQ: AtomicUsize = AtomicUsize::new(0);

    /// A unique, empty directory under the system temp dir for file-backed tests.
    fn temp_dir(tag: &str) -> PathBuf {
        let seq = TEST_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "thoughttree-{tag}-{}-{seq}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_file(dir: &Path, name: &str, contents: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    fn sample_export(nodes: &[Node], edges: &[Edge]) -> String {
        serde_json::json!({
            "app": "ThoughtTree",
            "format": "thoughttree.export",
            "version": 1,
            "exported_at": 123,
            "nodes": nodes,
            "edges": edges,
        })
        .to_string()
    }

    #[test]
    fn list_backups_returns_newest_first() {
        let dir = temp_dir("list-backups");
        std::fs::write(dir.join("thoughttree-100.db"), b"old").unwrap();
        std::fs::write(dir.join("thoughttree-300.db"), b"newest").unwrap();
        std::fs::write(dir.join("thoughttree-200.db"), b"middle").unwrap();
        // Not a database snapshot; must be ignored.
        std::fs::write(dir.join("notes.txt"), b"ignore me").unwrap();

        let backups = list_backups(&dir);
        assert_eq!(backups.len(), 3);
        assert_eq!(
            backups.iter().map(|b| b.created_at).collect::<Vec<_>>(),
            vec![300, 200, 100]
        );
        assert_eq!(backups[0].name, "thoughttree-300.db");
        assert!(backups[0].path.ends_with("thoughttree-300.db"));
        assert_eq!(backups[0].size, "newest".len() as u64);
    }

    #[test]
    fn read_import_rejects_wrong_format_and_accepts_a_valid_file() {
        let dir = temp_dir("read-import");
        let bad = write_file(
            &dir,
            "bad.json",
            r#"{"format":"something.else","version":1,"nodes":[],"edges":[]}"#,
        );
        assert_eq!(
            read_import(bad.to_string_lossy().to_string()).unwrap_err(),
            "error.importFormat"
        );

        let missing = write_file(&dir, "missing.json", r#"{"nodes":[],"edges":[]}"#);
        assert_eq!(
            read_import(missing.to_string_lossy().to_string()).unwrap_err(),
            "error.importFormat"
        );

        let payload = sample_export(&[node("a", None, true)], &[]);
        let good = write_file(&dir, "good.json", &payload);
        let snapshot = read_import(good.to_string_lossy().to_string()).unwrap();
        assert_eq!(snapshot.nodes.len(), 1);
        assert_eq!(snapshot.nodes[0].id, "a");
        assert!(snapshot.edges.is_empty());

        // The marker is the only required field: a minimal file is still read.
        let minimal = write_file(
            &dir,
            "minimal.json",
            &format!(
                r#"{{"format":"thoughttree.export","nodes":[{}]}}"#,
                serde_json::to_string(&node("b", None, true)).unwrap()
            ),
        );
        let snapshot = read_import(minimal.to_string_lossy().to_string()).unwrap();
        assert_eq!(snapshot.nodes.len(), 1);
        assert_eq!(snapshot.nodes[0].id, "b");
    }

    #[test]
    fn import_merge_adds_new_ids_and_overwrites_existing_ones() {
        let mut conn = open_in_memory().unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![node("keep", None, true), node("conflict", None, true)],
                ..Default::default()
            },
        )
        .unwrap();

        // The file carries a brand new id and a conflicting one, but not `keep`.
        let mut overwritten = node("conflict", None, false);
        overwritten.text = "from the file".to_string();
        let imported = Snapshot {
            nodes: vec![node("fresh", None, true), overwritten],
            edges: vec![],
        };
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: imported.nodes.clone(),
                upsert_edges: imported.edges.clone(),
                ..Default::default()
            },
        )
        .unwrap();

        let snap = load(&conn).unwrap();
        assert_eq!(snap.nodes.len(), 3);
        assert!(snap.nodes.iter().any(|n| n.id == "fresh"));
        assert!(snap.nodes.iter().any(|n| n.id == "keep"));
        let conflict = snap.nodes.iter().find(|n| n.id == "conflict").unwrap();
        assert_eq!(conflict.text, "from the file");
    }

    #[test]
    fn backup_rotate_folds_the_wal_into_the_copy() {
        let dir = temp_dir("rotate");
        let db_path = dir.join("thoughttree.db");
        let backup_dir = dir.join("backups");
        let mut conn = open(&db_path).unwrap();
        apply(
            &mut conn,
            &Changes {
                upsert_nodes: vec![node("a", None, true)],
                ..Default::default()
            },
        )
        .unwrap();

        // The row is only in the WAL at this point; a copy of the main file made
        // without a checkpoint would be missing it.
        backup_rotate(&conn, &db_path, &backup_dir, 5);
        drop(conn);

        let copy = std::fs::read_dir(&backup_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .next()
            .expect("a backup copy was written");
        let copied = open(&copy).unwrap();
        let snap = load(&copied).unwrap();
        assert_eq!(snap.nodes.len(), 1);
        assert_eq!(snap.nodes[0].id, "a");
    }

    #[test]
    fn restore_files_swaps_the_data_and_leaves_no_wal() {
        let dir = temp_dir("restore");
        let db_path = dir.join("thoughttree.db");
        let backup_dir = dir.join("backups");

        // The live database, and a snapshot holding different data.
        let mut live = open(&db_path).unwrap();
        apply(
            &mut live,
            &Changes {
                upsert_nodes: vec![node("live", None, true)],
                ..Default::default()
            },
        )
        .unwrap();
        drop(live);

        std::fs::create_dir_all(&backup_dir).unwrap();
        let backup_path = backup_dir.join("thoughttree-1.db");
        {
            let mut backup = open(&backup_path).unwrap();
            apply(
                &mut backup,
                &Changes {
                    upsert_nodes: vec![node("from-backup", None, true)],
                    ..Default::default()
                },
            )
            .unwrap();
        }

        // Stale sidecar files from the file about to be replaced; they must not
        // survive the swap.
        std::fs::write(db_path.with_extension("db-wal"), b"stale").unwrap();
        std::fs::write(db_path.with_extension("db-shm"), b"stale").unwrap();

        restore_files(&db_path, &backup_path, &backup_dir).unwrap();

        assert!(!db_path.with_extension("db-wal").exists());
        assert!(!db_path.with_extension("db-shm").exists());
        // A safety copy of the replaced file was taken.
        assert!(list_backups(&backup_dir).iter().any(|b| b.name.contains("prerestore")));

        let restored = open(&db_path).unwrap();
        let snap = load(&restored).unwrap();
        assert_eq!(snap.nodes.len(), 1);
        assert_eq!(snap.nodes[0].id, "from-backup");
    }
}
