import { useMemo } from 'react'
import { makeVisibility, filterTree, inboxOrder, focusList } from '../domain/focus'
import {
  unexplainedNodeIds,
  edgeForNode,
  linksForNode,
  linkedNodeIds,
  relatedNodeIds,
} from '../domain/relations'
import { reviewGroups, type ReviewGroup } from '../domain/review'
import { buildForest, flatten, pathText } from '../domain/tree'
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
  return useMemo(() => {
    const keep = makeVisibility({
      focusMode: state.focusMode,
      showLater: state.showLater,
      showDone: state.showDone,
      showArchived: state.showArchived,
      onlyUnexplained: state.onlyUnexplained,
      unexplained,
    })
    const forest = filterTree(buildForest(Object.values(state.nodes)), keep)
    return { forest, flat: flatten(forest, (node) => node.collapsed) }
  }, [
    state.nodes,
    state.focusMode,
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

export function useFocusList() {
  const { nodes } = useAppState()
  return useMemo(() => focusList(Object.values(nodes)), [nodes])
}

/**
 * Starred questions that are still unfiled. Focus mode only looks at the tree,
 * so these are the usual reason it looks empty right after you start using it.
 */
export function useStarredInInbox() {
  const { nodes } = useAppState()
  return useMemo(
    () =>
      inboxOrder(Object.values(nodes)).filter(
        (node) => node.priority === 'important' && node.status === 'open',
      ),
    [nodes],
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
