import { useMemo } from 'react'
import { makeVisibility, filterTree, inboxOrder, focusList } from '../domain/focus'
import { unexplainedNodeIds, edgeForNode } from '../domain/relations'
import { buildForest, flatten, pathText } from '../domain/tree'
import type { TreeItem } from '../domain/tree'
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

export function useEdgeFor(nodeId: string | null) {
  const { edges } = useAppState()
  return useMemo(
    () => (nodeId ? edgeForNode(Object.values(edges), nodeId) : undefined),
    [edges, nodeId],
  )
}

export function usePath(nodeId: string | null): string {
  const { nodes } = useAppState()
  return useMemo(() => (nodeId ? pathText(Object.values(nodes), nodeId) : ''), [nodes, nodeId])
}
