use serde::{Deserialize, Serialize};

/// A node is a captured thought. Field names mirror the SQLite columns so the
/// Rust struct, the database row and the TypeScript interface never drift.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub text: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub priority: String,
    pub status: String,
    pub parent_id: Option<String>,
    pub position: f64,
    pub note: Option<String>,
    pub conclusion: Option<String>,
    pub inbox: bool,
    pub collapsed: bool,
    pub source_app: Option<String>,
    pub source_title: Option<String>,
    /// The browser address bar at capture time, when it could be read. Optional
    /// on the way in so a changeset written before the feature still applies.
    #[serde(default)]
    pub source_url: Option<String>,
}

/// An edge records *why* one node relates to another. `kind` discriminates the
/// two meanings: `'parent'` is the tree link (`from_node` is the parent,
/// `to_node` the child, and a node has at most one incoming parent edge) while
/// `'link'` is a cross-cutting relation between any two nodes, unconstrained in
/// number.
///
/// `kind` defaults to `'parent'` on the way in, so an export written before the
/// feature existed still imports: back then every edge *was* a parent edge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub relation_type: String,
    pub reason: Option<String>,
    pub created_at: i64,
    #[serde(default = "default_kind")]
    pub kind: String,
}

fn default_kind() -> String {
    "parent".to_string()
}

#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

/// One entry in `<data>/backups/`. `backup_rotate` writes `.db` copies at
/// launch; this is what the restore UI lists.
#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub size: u64,
}

/// The single write primitive of the whole application. Every mutation — create,
/// edit, move, delete, triage, undo, redo — is expressed as a set of upserts and
/// deletes, applied atomically in one SQLite transaction.
#[derive(Debug, Default, Deserialize)]
pub struct Changes {
    #[serde(default)]
    pub upsert_nodes: Vec<Node>,
    #[serde(default)]
    pub upsert_edges: Vec<Edge>,
    #[serde(default)]
    pub delete_nodes: Vec<String>,
    #[serde(default)]
    pub delete_edges: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::Changes;

    /// A changeset written before `source_url` existed must still apply: the new
    /// field is optional on the way in and defaults to `None`.
    #[test]
    fn changes_without_source_url_deserializes() {
        let raw = r#"{
            "upsert_nodes": [{
                "id": "a",
                "text": "hello",
                "created_at": 1,
                "updated_at": 1,
                "priority": "normal",
                "status": "open",
                "parent_id": null,
                "position": 0.0,
                "note": null,
                "conclusion": null,
                "inbox": false,
                "collapsed": false,
                "source_app": "chrome",
                "source_title": "Example"
            }]
        }"#;
        let changes: Changes = serde_json::from_str(raw).expect("changeset deserializes");
        assert_eq!(changes.upsert_nodes.len(), 1);
        assert_eq!(changes.upsert_nodes[0].id, "a");
        assert!(changes.upsert_nodes[0].source_url.is_none());
    }

    /// And when the front end does send a URL, it round-trips.
    #[test]
    fn changes_with_source_url_deserializes() {
        let raw = r#"{
            "upsert_nodes": [{
                "id": "a",
                "text": "hello",
                "created_at": 1,
                "updated_at": 1,
                "priority": "normal",
                "status": "open",
                "parent_id": null,
                "position": 0.0,
                "note": null,
                "conclusion": null,
                "inbox": false,
                "collapsed": false,
                "source_app": "chrome",
                "source_title": "Example",
                "source_url": "jieni.ai/docs/reading/x"
            }]
        }"#;
        let changes: Changes = serde_json::from_str(raw).expect("changeset deserializes");
        assert_eq!(
            changes.upsert_nodes[0].source_url.as_deref(),
            Some("jieni.ai/docs/reading/x")
        );
    }
}
