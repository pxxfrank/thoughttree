import type { Node } from './types'
import type { TreeItem } from './tree'
import { descendantIds } from './tree'

export interface VisibilityOptions {
  /** The one focused question and the ids under it, or null when there is none. */
  focus: { root: string; ids: ReadonlySet<string> } | null
  showLater: boolean
  showDone: boolean
  showArchived: boolean
  onlyUnexplained: boolean
  /** Node ids whose relation to their parent has no reason yet. */
  unexplained: ReadonlySet<string>
}

export function makeVisibility(options: VisibilityOptions): (node: Node) => boolean {
  return (node) => {
    // Unfiled captures live in the Inbox until the user puts them in the tree.
    if (node.inbox) return false
    if (options.focus) {
      // The focused question is always shown, whatever its status, so pinning a
      // done or archived question does not make it vanish. Everything else must
      // be inside its subtree, and the user's filters still apply below.
      if (node.id === options.focus.root) return true
      if (!options.focus.ids.has(node.id)) return false
    }
    if (node.status === 'archived' && !options.showArchived) return false
    if (node.status === 'done' && !options.showDone) return false
    if (node.status === 'later' && !options.showLater) return false
    if (options.onlyUnexplained && !options.unexplained.has(node.id)) return false
    return true
  }
}

/**
 * The focused question and every id under it, or null when there is no focus
 * (or the id no longer names a node).
 */
export function focusScope(
  nodes: Node[],
  rootId: string | null,
): { root: string; ids: ReadonlySet<string> } | null {
  if (!rootId) return null
  if (!nodes.some((node) => node.id === rootId)) return null
  return { root: rootId, ids: new Set<string>([rootId, ...descendantIds(nodes, rootId)]) }
}

/**
 * Keeps a node when it is wanted, or when it is on the path to something that
 * is. Ancestors survive so a filtered tree still shows where a question lives.
 */
export function filterTree(items: TreeItem[], keep: (node: Node) => boolean): TreeItem[] {
  const out: TreeItem[] = []
  for (const item of items) {
    const children = filterTree(item.children, keep)
    if (keep(item.node) || children.length > 0) {
      out.push({ node: item.node, depth: item.depth, children })
    }
  }
  return out
}

export function inboxOrder(nodes: Node[]): Node[] {
  return nodes
    .filter((n) => n.inbox)
    .sort((a, b) => b.created_at - a.created_at || a.text.localeCompare(b.text))
}
