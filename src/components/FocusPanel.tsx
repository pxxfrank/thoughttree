import { useAppState, useStore } from '../state/context'
import { useFocusList, useInbox, useStarredInInbox } from '../state/selectors'
import { ancestorsOf } from '../domain/tree'
import type { Node } from '../domain/types'
import { useI18n } from '../i18n/useI18n'

function contextLabel(nodes: Node[], node: Node, root: string): string {
  const chain = ancestorsOf(nodes, node.id)
  if (chain.length === 0) return root
  return chain.map((n) => n.text).join(' › ')
}

/** Leaving a mode should look like an action, not like a stray label. */
function BackIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  )
}

export function FocusPanel() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const targets = useFocusList()
  const inbox = useInbox()
  const starred = useStarredInInbox()
  const nodes = Object.values(state.nodes)

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{t('panel.focus')}</span>
        <span className="count">{targets.length}</span>
        <span className="spacer" />
        {/* In the head, not at the foot of the list: this is how you get out of
            the mode, so it should be the first thing you can reach. */}
        <button className="btn" onClick={store.toggleFocusMode}>
          <BackIcon />
          {t('focus.leave')}
        </button>
      </div>
      <div className="focus-body">
        <div className="focus-title">{t('focus.title')}</div>
        <div className="focus-sub">{t('focus.sub')}</div>

        {targets.length === 0 && (
          <>
            <div className="empty" style={{ padding: '0 0 10px' }}>
              {t('empty.focus')}
            </div>
            <div className="hint" style={{ marginBottom: 16 }}>
              {t('focus.how')}
            </div>
          </>
        )}

        {/* The most common dead end: you star things while triaging the Inbox,
            then switch to Focus and find it empty. Say why, and offer the way
            back — Focus mode replaces the Inbox, so it is otherwise unreachable. */}
        {starred.length > 0 && (
          <div className="focus-callout">
            <div>{t('focus.starred', { n: starred.length })}</div>
            <button className="btn" onClick={store.toggleFocusMode}>
              {t('focus.goInbox')}
            </button>
          </div>
        )}

        {targets.length > 0 && (
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
                    <span className="focus-path">
                      {contextLabel(nodes, node, t('focus.thread'))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}

        {inbox.length > 0 && (
          <div className="hint" style={{ marginTop: 16 }}>
            {t('focus.waiting', { n: inbox.length })}
          </div>
        )}
      </div>
    </section>
  )
}
