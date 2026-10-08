import { useMemo } from 'react'
import { makeVisibility, filterTree, inboxOrder, focusScope } from '../domain/focus'
import {
  unexplainedNodeIds,
  edgeForNode,
  linksForNode,
  linkedNodeIds,
  relatedNodeIds,
} from '../domain/relations'
import { reviewGroups, type ReviewGroup } from '../domain/review'
import { buildForest, flatten, pathText, subtreeForest, subtreeRows } from '../domain/tree'
import type { TreeItem } from '../domain/tree'
import type { Edge, Node } from '../domain/types'
import { useAppState } from './context'

export function useUnexplained(): Set<string> {
  const { nodes, edges } = useAppState()
  return useMemo(
    () => unexplainedNodeIds(Object.values(nodes), Object.values(edges)),
    [nodes, edges],
  )
}

/** The filtered tree, both nested (for rendering) and flat (for keyboard nav). */
export function useVisibleForest(): { forest: TreeItem[]; flat: TreeItem[] } {
  const state = useAppState()
  const unexplained = useUnexplained()
  const focus = useMemo(
    () => focusScope(Object.values(state.nodes), state.focusRoot),
    [state.nodes, state.focusRoot],
  )
  return useMemo(() => {
    const keep = makeVisibility({
      focus,
      showLater: state.showLater,
      showDone: state.showDone,
      showArchived: state.showArchived,
      onlyUnexplained: state.onlyUnexplained,
      unexplained,
    })
    const all = buildForest(Object.values(state.nodes))
    // Focused: re-root at the focused question so what is on screen is exactly
    // that question and its sub-questions — no parents rescued back in.
    const forest = filterTree(focus ? subtreeForest(all, focus.root) : all, keep)
    return { forest, flat: flatten(forest, (node) => node.collapsed) }
  }, [
    state.nodes,
    focus,
    state.showLater,
    state.showDone,
    state.showArchived,
    state.onlyUnexplained,
    unexplained,
  ])
}

export function useInbox() {
  const { nodes } = useAppState()
  return useMemo(() => inboxOrder(Object.values(nodes)), [nodes])
}

/** The one question Focus is pinned to, or null. */
export function useFocusedNode(): Node | null {
  const state = useAppState()
  return useMemo(
    () => (state.focusRoot ? state.nodes[state.focusRoot] ?? null : null),
    [state.nodes, state.focusRoot],
  )
}

/** The focused question and its descendants as a flat, depth-annotated outline. */
export function useFocusSubtree(): { node: Node; depth: number }[] {
  const state = useAppState()
  return useMemo(
    () => (state.focusRoot ? subtreeRows(Object.values(state.nodes), state.focusRoot) : []),
    [state.nodes, state.focusRoot],
  )
}

export function useReviewGroups(): ReviewGroup[] {
  const { nodes, edges, sessionSeed } = useAppState()
  return useMemo(
    () => reviewGroups(Object.values(nodes), Object.values(edges), sessionSeed),
    [nodes, edges, sessionSeed],
  )
}

/** Questions that have been answered, newest answer first, with their path. */
export function useConclusions(): { node: Node; path: string }[] {
  const { nodes } = useAppState()
  return useMemo(() => {
    const all = Object.values(nodes)
    return all
      .filter((node) => !node.inbox && (node.conclusion ?? '').trim() !== '')
      .sort((a, b) => b.updated_at - a.updated_at)
      .map((node) => ({ node, path: pathText(all, node.id) }))
  }, [nodes])
}

export function useEdgeFor(nodeId: string | null) {
  const { edges } = useAppState()
  return useMemo(
    () => (nodeId ? edgeForNode(Object.values(edges), nodeId) : undefined),
    [edges, nodeId],
  )
}

/** A node's cross-branch links, split into outgoing and incoming. */
export function useLinksFor(nodeId: string | null): { outgoing: Edge[]; incoming: Edge[] } {
  const { edges } = useAppState()
  return useMemo(
    () =>
      nodeId
        ? linksForNode(Object.values(edges), nodeId)
        : { outgoing: [], incoming: [] },
    [edges, nodeId],
  )
}

/** Every node id that takes part in at least one link, for the tree-row marker. */
export function useLinkedIds(): Set<string> {
  const { edges } = useAppState()
  return useMemo(() => linkedNodeIds(Object.values(edges)), [edges])
}

/**
 * The peers on the other end of the selected node's links. Stable per input so
 * it can feed a class list; empty when nothing is selected.
 */
export function useRelatedIds(): Set<string> {
  const { edges, selectedId } = useAppState()
  return useMemo(
    () => (selectedId ? relatedNodeIds(Object.values(edges), selectedId) : new Set<string>()),
    [edges, selectedId],
  )
}

export function usePath(nodeId: string | null): string {
  const { nodes } = useAppState()
  return useMemo(() => (nodeId ? pathText(Object.values(nodes), nodeId) : ''), [nodes, nodeId])
}
