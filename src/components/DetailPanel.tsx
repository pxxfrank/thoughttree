import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { LINK_RELATION_TYPES, relationKey } from '../domain/relations'
import { indexChildren } from '../domain/tree'
import type { Edge, Node, Status } from '../domain/types'
import { useI18n } from '../i18n/useI18n'
import { useAppState, useStore } from '../state/context'
import { useEdgeFor, useLinksFor } from '../state/selectors'
import { openUrl } from '../storage/desktop-actions'

const STATUSES: { value: Status; key: string }[] = [
  { value: 'open', key: 'status.open' },
  { value: 'later', key: 'status.later' },
  { value: 'done', key: 'status.done' },
  { value: 'archived', key: 'status.archived' },
]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  )
}

function AutoText({
  value,
  placeholder,
  onCommit,
  className = 'detail-area',
  rows = 3,
}: {
  value: string
  placeholder: string
  onCommit: (next: string) => void
  className?: string
  rows?: number
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <textarea
      className={className}
      value={draft}
      placeholder={placeholder}
      rows={rows}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
    />
  )
}

/** One cross-branch link, from this question's point of view. */
function LinkRow({ link, peerId }: { link: Edge; peerId: string }) {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const peer = state.nodes[peerId]
  if (!peer) return null
  return (
    <div className="link-row">
      <button className="link-peer" title={peer.text} onClick={() => store.revealNode(peerId)}>
        {peer.text}
      </button>
      {link.reason && <div className="link-reason">{link.reason}</div>}
      <span className="link-actions">
        <button className="btn ghost" title={t('link.edit')} onClick={() => store.openLinkEditor(link)}>
          {t('link.edit')}
        </button>
        <button className="btn ghost" title={t('link.remove')} onClick={() => store.removeLink(link)}>
          ✕
        </button>
      </span>
    </div>
  )
}

export function DetailPanel() {
  const store = useStore()
  const state = useAppState()
  const { t } = useI18n()
  const node = state.selectedId ? state.nodes[state.selectedId] : undefined
  const edge = useEdgeFor(state.selectedId)
  const links = useLinksFor(state.selectedId)

  if (!node) {
    return (
      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">{t('panel.question')}</span>
        </div>
        <div className="empty">{t('empty.detail')}</div>
      </section>
    )
  }

  const children: Node[] = (indexChildren(Object.values(state.nodes)).get(node.id) ?? []).filter(
    (child) => child.status !== 'archived',
  )
  const openChildren = children.filter((child) => child.status !== 'done')

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{t('panel.question')}</span>
        <span className="spacer" />
        <button
          className="btn ghost icon"
          title={t('detail.delete.title')}
          onClick={() => store.remove([node.id])}
        >
          ✕
        </button>
      </div>

      <div className="detail">
        <Field label={t('field.question')}>
          <AutoText
            className="detail-question"
            rows={2}
            value={node.text}
            placeholder={t('detail.questionPlaceholder')}
            onCommit={(next) => store.setText(node.id, next)}
          />
        </Field>

        <Field label={t('field.priority')}>
          <div className="chips">
            <button
              className={`chip ${node.priority === 'normal' ? 'on' : ''}`}
              onClick={() => store.setPriority(node.id, 'normal')}
            >
              {t('priority.normal')}
            </button>
            <button
              className={`chip important ${node.priority === 'important' ? 'on' : ''}`}
              onClick={() => store.setPriority(node.id, 'important')}
              title="Ctrl+I"
            >
              {t('priority.important')}
            </button>
          </div>
        </Field>

        <Field label={t('field.status')}>
          <div className="chips">
            {STATUSES.map((status) => (
              <button
                key={status.value}
                className={`chip ${status.value} ${node.status === status.value ? 'on' : ''}`}
                onClick={() => store.setStatus(node.id, status.value)}
              >
                {t(status.key)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('field.whyHere')}>
          {node.parent_id === null ? (
            <div className="field-value hint">{t('detail.noParent')}</div>
          ) : edge?.reason ? (
            <div>
              <div className="reason-quote">{edge.reason}</div>
              <div className="hint" style={{ marginTop: 5 }}>
                {t(relationKey(edge.relation_type))} ·{' '}
                <button
                  className="btn ghost"
                  style={{ padding: '0 4px' }}
                  onClick={() => store.explain(node.id, edge.relation_type, '')}
                >
                  {t('detail.rewrite')}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="reason-quote missing">{t('detail.unexplained')}</div>
              <button
                className="btn primary"
                style={{ marginTop: 6 }}
                onClick={() => store.openWhyHere(node.id)}
              >
                {t('detail.explain')}
              </button>
            </div>
          )}
        </Field>

        <Field label={t('detail.relations')}>
          {links.outgoing.length === 0 && links.incoming.length === 0 ? (
            <div className="hint">{t('link.none')}</div>
          ) : (
            <div className="link-groups">
              {LINK_RELATION_TYPES.map((type) => {
                const out = links.outgoing.filter((link) => link.relation_type === type)
                const incoming = links.incoming.filter((link) => link.relation_type === type)
                if (out.length === 0 && incoming.length === 0) return null
                return (
                  <div key={type} className="link-group">
                    <div className="link-group-title">{t(relationKey(type))}</div>
                    {out.length > 0 && <div className="link-sub">{t('link.out.title')}</div>}
                    {out.map((link) => (
                      <LinkRow key={link.id} link={link} peerId={link.to_node} />
                    ))}
                    {incoming.length > 0 && <div className="link-sub">{t('link.in.title')}</div>}
                    {incoming.map((link) => (
                      <LinkRow key={link.id} link={link} peerId={link.from_node} />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
          <button className="btn" style={{ marginTop: 6 }} onClick={() => store.startLink(node.id)}>
            {t('link.add')}
          </button>
        </Field>

        <Field label={t('field.notes')}>
          <AutoText
            value={node.note ?? ''}
            placeholder={t('detail.notesPlaceholder')}
            onCommit={(next) => store.setNote(node.id, next)}
          />
        </Field>

        <Field label={t('field.conclusion')}>
          <AutoText
            value={node.conclusion ?? ''}
            placeholder={t('detail.conclusionPlaceholder')}
            onCommit={(next) => store.setConclusion(node.id, next)}
          />
        </Field>

        {(node.source_app || node.source_title || node.source_url) && (
          <Field label={t('field.source')}>
            <div className="field-value">{node.source_app ?? t('field.source.unknown')}</div>
            {node.source_title && (
              <div className="hint" style={{ marginTop: 5 }}>
                {node.source_title}
              </div>
            )}
            {node.source_url && (
              <div className="hint" style={{ marginTop: 5 }}>
                <button
                  type="button"
                  title={t('field.source.open')}
                  onClick={() => {
                    // A refused command rejects; unhandled, that is
                    // indistinguishable from the button not working.
                    void openUrl(node.source_url as string).catch((error) => {
                      store.toast(
                        typeof error === 'string' && error.startsWith('error.')
                          ? error
                          : 'error.openUrlFailed',
                        'error',
                      )
                    })
                  }}
                  style={{
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    font: 'inherit',
                    textAlign: 'left',
                    color: 'var(--accent-text)',
                    cursor: 'pointer',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {node.source_url}
                </button>
              </div>
            )}
          </Field>
        )}

        <Field label={t('field.openQuestions', { n: openChildren.length })}>
          {children.length === 0 ? (
            <div className="hint">{t('detail.noChildren')}</div>
          ) : (
            <ul className="child-list">
              {children.map((child) => (
                <li key={child.id}>
                  <button
                    className={`child-row ${child.status}`}
                    onClick={() => store.select(child.id)}
                  >
                    <span className="mark">
                      {child.priority === 'important' ? '★' : child.status === 'done' ? '✓' : '·'}
                    </span>
                    <span className="label">{child.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      </div>
    </section>
  )
}
