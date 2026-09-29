use crate::models::{Changes, Edge, Node, Snapshot};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: i32 = 1;

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
        "SELECT id, from_node, to_node, relation_type, reason, created_at FROM edges",
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
            // A node has at most one incoming edge; drop any stale edge for the
            // same child before writing the new one.
            let mut clear_edge =
                tx.prepare("DELETE FROM edges WHERE to_node = ?1 AND id <> ?2")?;
            let mut up_edge = tx.prepare(
                "INSERT INTO edges (id, from_node, to_node, relation_type, reason, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                   from_node = excluded.from_node,
                   to_node = excluded.to_node,
                   relation_type = excluded.relation_type,
                   reason = excluded.reason",
            )?;
            for e in &changes.upsert_edges {
                clear_edge.execute(params![e.to_node, e.id])?;
                up_edge.execute(params![
                    e.id,
                    e.from_node,
                    e.to_node,
                    e.relation_type,
                    e.reason,
                    e.created_at
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

/// Keeps the `keep` most recent database snapshots so a crash or a bad edit
/// never costs more than one session.
pub fn backup_rotate(db_path: &Path, backup_dir: &Path, keep: usize) {
    if !db_path.exists() {
        return;
    }
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
}
