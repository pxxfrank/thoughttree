import { useAppState, useStore } from '../state/context'
import { useFocusList, useInbox } from '../state/selectors'
import { ancestorsOf } from '../domain/tree'
import type { Node } from '../domain/types'

function contextLabel(nodes: Node[], node: Node): string {
  const chain = ancestorsOf(nodes, node.id)
  if (chain.length === 0) return 'Main thread'
  return chain.map((n) => n.text).join(' › ')
}

export function FocusPanel() {
  const store = useStore()
  const state = useAppState()
  const targets = useFocusList()
  const inbox = useInbox()
  const nodes = Object.values(state.nodes)

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">Focus</span>
        <span className="count">{targets.length}</span>
      </div>
      <div className="focus-body">
        <div className="focus-title">Current important questions</div>
        <div className="focus-sub">
          Everything else is still saved. It is just not what you are solving right now.
        </div>

        {inbox.length > 0 && (
          <div className="hint" style={{ marginBottom: 18 }}>
            {inbox.length} unprocessed {inbox.length === 1 ? 'thought is' : 'thoughts are'} waiting
            in the Inbox.{' '}
            <button
              className="btn ghost"
              style={{ padding: '0 4px' }}
              onClick={store.toggleFocusMode}
            >
              Leave focus
            </button>
          </div>
        )}

        {targets.length === 0 ? (
          <div className="empty">
            Nothing is marked important and open.
            <br />
            Star a question with <kbd>Ctrl</kbd>+<kbd>I</kbd> to pull it back into focus.
          </div>
        ) : (
          <ol className="focus-list">
            {targets.map((node, index) => (
              <li key={node.id}>
                <button
                  className={`focus-item ${state.selectedId === node.id ? 'selected' : ''}`}
                  onClick={() => store.select(node.id)}
                >
                  <span className="focus-index">{index + 1}.</span>
                  <span>
                    <span className="focus-text">{node.text}</span>
                    <span className="focus-path">{contextLabel(nodes, node)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
