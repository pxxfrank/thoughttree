import type { Node } from './types'
import type { TreeItem } from './tree'

/** Focus Mode answers one question: what am I actually solving right now? */
export function isFocusTarget(node: Node): boolean {
  return node.priority === 'important' && node.status === 'open'
}

export interface VisibilityOptions {
  focusMode: boolean
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
    if (node.status === 'archived' && !options.showArchived) return false
    if (node.status === 'done' && !options.showDone) return false
    if (node.status === 'later' && !options.showLater) return false
    if (options.onlyUnexplained && !options.unexplained.has(node.id)) return false
    if (options.focusMode && !isFocusTarget(node)) return false
    return true
  }
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

/**
 * The list shown in Focus Mode: the questions in the tree that actually matter
 * right now. Unfiled Inbox captures are deliberately left out — they are not
 * part of the main thread until the user says where they belong.
 */
export function focusList(nodes: Node[]): Node[] {
  return nodes
    .filter((node) => !node.inbox && isFocusTarget(node))
    .sort((a, b) => a.created_at - b.created_at)
}
