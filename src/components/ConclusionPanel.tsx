import { useAppState, useStore } from '../state/context'
import { useConclusions } from '../state/selectors'
import { useI18n } from '../i18n/useI18n'

export function ConclusionPanel() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const items = useConclusions()

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{t('panel.conclusions')}</span>
      </div>
      <div className="focus-body">
        <div className="focus-title">{t('conclusions.title')}</div>
        <div className="focus-sub">{t('conclusions.sub')}</div>

        {items.length === 0 ? (
          <div className="empty">{t('conclusions.empty')}</div>
        ) : (
          <ol className="focus-list">
            {items.map(({ node, path }) => (
              <li key={node.id}>
                <button
                  className={`focus-item ${state.selectedId === node.id ? 'selected' : ''}`}
                  onClick={() => store.revealNode(node.id)}
                >
                  <span>
                    <span className="focus-text">{node.conclusion}</span>
                    <span className="focus-path">{path}</span>
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
