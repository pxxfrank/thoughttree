import { useRef, useState } from 'react'
import { useAppState, useStore } from '../state/context'
import { useInbox } from '../state/selectors'
import { relativeTime } from '../util/format'
import { isComposing } from '../util/keyboard'
import { useDnd } from './dnd'

export function InboxPanel() {
  const store = useStore()
  const state = useAppState()
  const items = useInbox()
  const { begin, isDragging } = useDnd()
  const lastClicked = useRef<number>(-1)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const selection = state.inboxSelection

  const toggle = (index: number, additive: boolean, range: boolean) => {
    const id = items[index].id
    if (range && lastClicked.current >= 0) {
      const [from, to] = [lastClicked.current, index].sort((a, b) => a - b)
      const ids = items.slice(from, to + 1).map((n) => n.id)
      store.selectInbox([...new Set([...selection, ...ids])])
    } else if (additive) {
      store.selectInbox(
        selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id],
      )
    } else {
      store.selectInbox(selection.includes(id) && selection.length === 1 ? [] : [id])
      store.select(id)
    }
    lastClicked.current = index
  }

  const bulk = (action: 'later' | 'important' | 'open' | 'archive' | 'delete') => {
    if (selection.length === 0) return
    if (action === 'delete') {
      store.remove(selection)
    } else if (action === 'important') {
      for (const id of selection) store.setPriority(id, 'important')
    } else if (action === 'archive') {
      for (const id of selection) store.setStatus(id, 'archived')
    } else if (action === 'later') {
      for (const id of selection) store.setStatus(id, 'later')
    } else {
      for (const id of selection) store.setStatus(id, 'open')
    }
    store.selectInbox([])
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">Inbox</span>
        <span className="count">{items.length}</span>
        <span className="spacer" />
        {items.length > 0 && (
          <button
            className="btn ghost"
            onClick={() => store.selectInbox(selection.length === items.length ? [] : items.map((n) => n.id))}
          >
            {selection.length === items.length ? 'Clear' : 'Select all'}
          </button>
        )}
      </div>

      {selection.length > 0 && (
        <div className="bulk-bar">
          <span className="count">{selection.length} selected</span>
          <span className="spacer" />
          <button className="btn" onClick={() => bulk('important')}>
            ★ Important
          </button>
          <button className="btn" onClick={() => bulk('later')}>
            ↓ Later
          </button>
          <button className="btn" onClick={() => bulk('open')}>
            ↺ Open
          </button>
          <button className="btn" onClick={() => bulk('archive')}>
            Archive
          </button>
          <button className="btn" onClick={() => bulk('delete')}>
            Delete
          </button>
        </div>
      )}

      <div className="panel-body" onClick={() => store.selectInbox([])}>
        {items.length === 0 ? (
          <div className="empty">
            Inbox is empty.
            <br />
            Every captured thought lands here, unfiled and unfiltered.
          </div>
        ) : (
          items.map((node, index) => (
            <div
              key={node.id}
              className={[
                'inbox-item',
                selection.includes(node.id) ? 'selected' : '',
                isDragging(node.id) ? 'dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-inbox-id={node.id}
              onPointerDown={(event) => begin({ ids: [node.id], label: node.text }, event)}
              onClick={(event) => {
                event.stopPropagation()
                toggle(index, event.ctrlKey || event.metaKey, event.shiftKey)
              }}
              onDoubleClick={() => {
                setEditing(node.id)
                setDraft(node.text)
              }}
            >
              <span className="inbox-grip" title="Drag into the tree">
                ⋮⋮
              </span>
              <div className="body">
                {editing === node.id ? (
                  <input
                    className="edit-input"
                    value={draft}
                    autoFocus
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                      store.setText(node.id, draft)
                      setEditing(null)
                    }}
                    onKeyDown={(event) => {
                      if (isComposing(event)) return
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        store.setText(node.id, draft)
                        setEditing(null)
                      } else if (event.key === 'Escape') {
                        setEditing(null)
                      }
                    }}
                  />
                ) : (
                  <div className="text">{node.text}</div>
                )}
                <div className="inbox-meta">
                  <span>{relativeTime(node.created_at)}</span>
                  {(node.priority === 'important' || node.status !== 'open') && (
                    <span>
                      {node.priority === 'important' ? '★' : ''}
                      {node.status !== 'open' ? ` ${node.status}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div className="hint" style={{ padding: '10px 10px 0' }}>
          Drag an item into the tree — or select several and file them together.
        </div>
      </div>
    </section>
  )
}
