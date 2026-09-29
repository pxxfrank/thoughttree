import { useAppState, useStore } from '../state/context'
import { useFocusList, useInbox } from '../state/selectors'
import { ancestorsOf } from '../domain/tree'
import type { Node } from '../domain/types'
import { useI18n } from '../i18n/useI18n'

function contextLabel(nodes: Node[], node: Node, root: string): string {
  const chain = ancestorsOf(nodes, node.id)
  if (chain.length === 0) return root
  return chain.map((n) => n.text).join(' › ')
}

export function FocusPanel() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const targets = useFocusList()
  const inbox = useInbox()
  const nodes = Object.values(state.nodes)

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{t('panel.focus')}</span>
        <span className="count">{targets.length}</span>
      </div>
      <div className="focus-body">
        <div className="focus-title">{t('focus.title')}</div>
        <div className="focus-sub">{t('focus.sub')}</div>

        {inbox.length > 0 && (
          <div className="hint" style={{ marginBottom: 18 }}>
            {t('focus.waiting', { n: inbox.length })}{' '}
            <button
              className="btn ghost"
              style={{ padding: '0 4px' }}
              onClick={store.toggleFocusMode}
            >
              {t('focus.leave')}
            </button>
          </div>
        )}

        {targets.length === 0 ? (
          <div className="empty">{t('empty.focus')}</div>
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
                    <span className="focus-path">{contextLabel(nodes, node, t('focus.thread'))}</span>
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
