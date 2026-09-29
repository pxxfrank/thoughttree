import { useAppState, useStore } from '../state/context'
import { useReviewGroups } from '../state/selectors'
import { useI18n } from '../i18n/useI18n'

export function ReviewPanel() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const groups = useReviewGroups()

  return (
    <section className="panel">
      {/* No count in the head on purpose: Review is not a backlog to clear. */}
      <div className="panel-head">
        <span className="panel-title">{t('panel.review')}</span>
      </div>
      <div className="focus-body">
        <div className="focus-title">{t('review.title')}</div>
        <div className="focus-sub">{t('review.sub')}</div>

        {groups.length === 0 && <div className="empty">{t('review.empty')}</div>}

        {groups.map((group) => (
          <div className="review-group" key={group.key}>
            <div className="review-group-title">{t(`review.${group.key}`)}</div>
            <ol className="focus-list">
              {group.nodes.map((node) => (
                <li key={node.id}>
                  <button
                    className={`focus-item ${state.selectedId === node.id ? 'selected' : ''}`}
                    onClick={() => store.revealNode(node.id)}
                  >
                    <span className="focus-text">{node.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ))}

        <div style={{ marginTop: 18 }}>
          <button className="btn ghost" onClick={store.reshuffle}>
            {t('review.reshuffle')}
          </button>
        </div>
      </div>
    </section>
  )
}
