import { useStore } from '../state/context'
import { useFocusedNode, useFocusSubtree, useInbox, usePath } from '../state/selectors'
import type { Node } from '../domain/types'
import { useI18n } from '../i18n/useI18n'

/** One glyph per row: ★ important, ✓ done, ↓ later, · open. */
function statusMark(node: Node): string {
  if (node.priority === 'important') return '★'
  if (node.status === 'done') return '✓'
  if (node.status === 'later') return '↓'
  return '·'
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
  const { t } = useI18n()
  const focused = useFocusedNode()
  const rows = useFocusSubtree()
  const inbox = useInbox()

  // `usePath` includes the focused question itself; the pinned row already shows
  // its text, so only the ancestors are worth repeating as context.
  const path = usePath(focused?.id ?? null)
  const ancestorPath = path.split(' › ').slice(0, -1).join(' › ')
  const subRows = rows.filter((row) => row.depth > 0)

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{t('panel.focus')}</span>
        <span className="spacer" />
        {/* In the head, not at the foot of the list: this is how you get out of
            the mode, so it should be the first thing you can reach. */}
        <button className="btn" onClick={store.clearFocus}>
          <BackIcon />
          {t('focus.leave')}
        </button>
      </div>
      <div className="focus-body">
        <div className="focus-title">{t('focus.title')}</div>
        <div className="focus-sub">{t('focus.sub')}</div>

        {!focused ? (
          <>
            <div className="empty" style={{ padding: '0 0 10px' }}>
              {t('empty.focus')}
            </div>
            <div className="hint" style={{ marginBottom: 16 }}>
              {t('focus.how')}
            </div>
          </>
        ) : (
          <>
            {/* The focused question is pinned above its subtree, whatever its
                status, so it is always the thing you are looking at. */}
            <div className="focus-text">{focused.text}</div>
            {ancestorPath && <div className="focus-path">{ancestorPath}</div>}

            {subRows.length > 0 && (
              <>
                <div className="focus-title" style={{ marginTop: 18 }}>
                  {t('focus.subquestions')}
                </div>
                <ul className="child-list">
                  {subRows.map((row) => (
                    <li key={row.node.id}>
                      <button
                        className={`child-row ${row.node.status}`}
                        style={{ paddingLeft: row.depth * 12 }}
                        onClick={() => store.select(row.node.id)}
                      >
                        <span className="mark">{statusMark(row.node)}</span>
                        <span className="label">{row.node.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
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
