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
