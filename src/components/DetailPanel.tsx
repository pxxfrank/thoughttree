import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { relationLabel } from '../domain/relations'
import { indexChildren } from '../domain/tree'
import type { Node, Status } from '../domain/types'
import { useAppState, useStore } from '../state/context'
import { useEdgeFor } from '../state/selectors'

const STATUSES: { value: Status; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'later', label: 'Later' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
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

export function DetailPanel() {
  const store = useStore()
  const state = useAppState()
  const node = state.selectedId ? state.nodes[state.selectedId] : undefined
  const edge = useEdgeFor(state.selectedId)

  if (!node) {
    return (
      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">Question</span>
        </div>
        <div className="empty">
          Select a question to see its status, its relation to its parent, and your notes.
        </div>
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
        <span className="panel-title">Question</span>
        <span className="spacer" />
        <button
          className="btn ghost icon"
          title="Delete this question and everything under it"
          onClick={() => store.remove([node.id])}
        >
          ✕
        </button>
      </div>

      <div className="detail">
        <Field label="Question">
          <AutoText
            className="detail-question"
            rows={2}
            value={node.text}
            placeholder="What are you actually trying to answer?"
            onCommit={(next) => store.setText(node.id, next)}
          />
        </Field>

        <Field label="Priority">
          <div className="chips">
            <button
              className={`chip ${node.priority === 'normal' ? 'on' : ''}`}
              onClick={() => store.setPriority(node.id, 'normal')}
            >
              Normal
            </button>
            <button
              className={`chip important ${node.priority === 'important' ? 'on' : ''}`}
              onClick={() => store.setPriority(node.id, 'important')}
              title="Ctrl+I"
            >
              ★ Important
            </button>
          </div>
        </Field>

        <Field label="Status">
          <div className="chips">
            {STATUSES.map((status) => (
              <button
                key={status.value}
                className={`chip ${status.value} ${node.status === status.value ? 'on' : ''}`}
                onClick={() => store.setStatus(node.id, status.value)}
              >
                {status.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Why here?">
          {node.parent_id === null ? (
            <div className="field-value hint">Top-level question — nothing to explain.</div>
          ) : edge?.reason ? (
            <div>
              <div className="reason-quote">{edge.reason}</div>
              <div className="hint" style={{ marginTop: 5 }}>
                {relationLabel(edge.relation_type)} ·{' '}
                <button
                  className="btn ghost"
                  style={{ padding: '0 4px' }}
                  onClick={() => store.explain(node.id, edge.relation_type, '')}
                >
                  rewrite
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="reason-quote missing">
                ⚠ Unexplained relation — you filed this here without saying why.
              </div>
              <button
                className="btn primary"
                style={{ marginTop: 6 }}
                onClick={() => store.openWhyHere(node.id)}
              >
                Explain relationship
              </button>
            </div>
          )}
        </Field>

        <Field label="Notes">
          <AutoText
            value={node.note ?? ''}
            placeholder="Working notes, half-formed thoughts…"
            onCommit={(next) => store.setNote(node.id, next)}
          />
        </Field>

        <Field label="Conclusion">
          <AutoText
            value={node.conclusion ?? ''}
            placeholder="What is the answer, once you have one?"
            onCommit={(next) => store.setConclusion(node.id, next)}
          />
        </Field>

        <Field label={`Open questions (${openChildren.length})`}>
          {children.length === 0 ? (
            <div className="hint">No sub-questions yet.</div>
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
