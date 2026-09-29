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

/// An edge records *why* one node sits under another. `from_node` is the parent,
/// `to_node` is the child. A node has at most one incoming edge (one parent),
/// so `to_node` is unique.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub relation_type: String,
    pub reason: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
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
