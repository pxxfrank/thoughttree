import { useEffect, useRef, useState } from 'react'
import type { TreeItem } from '../domain/tree'
import { useAppState, useStore } from '../state/context'
import { useUnexplained, useVisibleForest } from '../state/selectors'
import { isComposing } from '../util/keyboard'
import { useDnd } from './dnd'

function dropClass(target: ReturnType<typeof useDnd>['target'], nodeId: string): string {
  if (!target || target.kind !== 'row' || target.nodeId !== nodeId) return ''
  if (target.where === 'child') return 'drop-into'
  return `drop-${target.where}`
}

function TextEditor({
  initial,
  onCommit,
  onCancel,
  className,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
  className: string
}) {
  const [value, setValue] = useState(initial)
  const settled = useRef(false)

  const commit = () => {
    if (settled.current) return
    settled.current = true
    onCommit(value)
  }

  return (
    <input
      className={className}
      value={value}
      autoFocus
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (isComposing(event)) return
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          settled.current = true
          onCancel()
        }
      }}
      onBlur={commit}
    />
  )
}

function InlineCreate({ parentId, index }: { parentId: string | null; index: number }) {
  const store = useStore()
  const [cursor, setCursor] = useState(index)
  const [value, setValue] = useState('')
  const settled = useRef(false)

  useEffect(() => {
    setCursor(index)
  }, [index])

  const finish = () => {
    if (settled.current) return
    settled.current = true
    store.cancelCreate()
  }

  const submit = (keepGoing: boolean) => {
    const text = value.trim()
    if (!text) {
      finish()
      return
    }
    store.addChild(parentId, cursor, text)
    setValue('')
    if (keepGoing) {
      setCursor((current) => current + 1)
      store.beginCreate(parentId, cursor + 1)
    } else {
      finish()
    }
  }

  return (
    <div className="row" style={{ paddingLeft: 6 }}>
      <span className="caret leaf" />
      <span className="star" style={{ opacity: 0.3 }}>
        ☆
      </span>
      <input
        className="create-input"
        value={value}
        autoFocus
        placeholder="New question…  (Enter to add, Esc to stop)"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (isComposing(event)) return
          if (event.key === 'Enter') {
            event.preventDefault()
            submit(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            finish()
          }
        }}
        onBlur={() => submit(false)}
      />
    </div>
  )
}

function TreeRow({ item }: { item: TreeItem }) {
  const store = useStore()
  const state = useAppState()
  const unexplained = useUnexplained()
  const { target, begin, isDragging } = useDnd()
  const ref = useRef<HTMLDivElement>(null)
  const node = item.node
  const selected = state.selectedId === node.id
  const editing = state.editingId === node.id
  const hasChildren = item.children.length > 0

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const classes = [
    'row',
    selected ? 'selected' : '',
    node.priority === 'important' ? 'important' : '',
    node.status === 'done' ? 'done' : '',
    node.status === 'later' ? 'later' : '',
    isDragging(node.id) ? 'dragging' : '',
    dropClass(target, node.id),
  ]
    .filter(Boolean)
    .join(' ')

  const statusMark = node.status === 'done' ? '✓' : node.status === 'later' ? '↓' : ''

  return (
    <li>
      <div
        ref={ref}
        className={classes}
        data-node-id={node.id}
        style={{ paddingLeft: 4 + item.depth * 16 }}
        onPointerDown={(event) => begin({ ids: [node.id], label: node.text }, event)}
        onClick={(event) => {
          event.stopPropagation()
          store.select(node.id)
        }}
        onDoubleClick={() => store.beginEdit(node.id)}
      >
        <button
          className={`caret ${hasChildren ? '' : 'leaf'} ${node.collapsed ? '' : 'open'}`}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation()
            store.toggleCollapse(node.id)
          }}
          title={node.collapsed ? 'Expand' : 'Collapse'}
        >
          ▶
        </button>

        <button
          className={`star ${node.priority === 'important' ? 'on' : ''}`}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation()
            store.togglePriority(node.id)
          }}
          title="Important (Ctrl+I)"
        >
          {node.priority === 'important' ? '★' : '☆'}
        </button>

        {editing ? (
          <TextEditor
            className="edit-input"
            initial={node.text}
            onCommit={(value) => {
              store.setText(node.id, value)
              store.endEdit()
            }}
            onCancel={() => store.endEdit()}
          />
        ) : (
          <>
            <span className="status-mark">{statusMark}</span>
            <span
              className="row-text"
              title={node.text}
              onDoubleClick={() => store.beginEdit(node.id)}
            >
              {node.text}
            </span>
            {unexplained.has(node.id) && (
              <span className="warn-mark" title="Unexplained relation — say why this belongs here">
                ⚠
              </span>
            )}
          </>
        )}

        <span className="row-actions" data-no-drag>
          <button
            title="Add sub-question (Tab)"
            onClick={(event) => {
              event.stopPropagation()
              store.select(node.id)
              store.beginCreate(node.id, item.children.length)
            }}
          >
            +
          </button>
          <button
            title="Move to Later (Ctrl+L)"
            onClick={(event) => {
              event.stopPropagation()
              store.setStatus(node.id, node.status === 'later' ? 'open' : 'later')
            }}
          >
            ↓
          </button>
          <button
            title="Mark done (Ctrl+K)"
            onClick={(event) => {
              event.stopPropagation()
              store.setStatus(node.id, node.status === 'done' ? 'open' : 'done')
            }}
          >
            ✓
          </button>
          <button
            title="Delete (Del)"
            onClick={(event) => {
              event.stopPropagation()
              store.remove([node.id])
            }}
          >
            ✕
          </button>
        </span>
      </div>

      <Branch items={item.children} parentId={node.id} hidden={node.collapsed} />
    </li>
  )
}

function Branch({
  items,
  parentId,
  hidden,
}: {
  items: TreeItem[]
  parentId: string | null
  hidden?: boolean
}) {
  const state = useAppState()
  if (hidden) return null

  const creating = state.creating
  const rows: (TreeItem | 'CREATE')[] = [...items]
  if (creating && creating.parentId === parentId) {
    rows.splice(Math.min(creating.index, items.length), 0, 'CREATE')
  }

  if (rows.length === 0) return null

  return (
    <ul className="branch">
      {rows.map((row) =>
        row === 'CREATE' ? (
          <li key="create">
            <InlineCreate parentId={parentId} index={creating?.index ?? 0} />
          </li>
        ) : (
          <TreeRow key={row.node.id} item={row} />
        ),
      )}
    </ul>
  )
}

export function TreePanel() {
  const store = useStore()
  const state = useAppState()
  const { forest, flat } = useVisibleForest()
  const { target } = useDnd()
  const treeTotal = Object.values(state.nodes).filter((node) => !node.inbox).length

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">Research Tree</span>
        <span className="count">
          {flat.length}/{treeTotal}
        </span>
        <span className="spacer" />
        <button
          className="btn ghost icon"
          title="New root question"
          onClick={() => store.beginCreate(null, forest.length)}
        >
          +
        </button>
      </div>
      <div
        className="panel-body"
        onClick={() => {
          store.select(null)
          store.cancelCreate()
        }}
      >
        {forest.length === 0 && !state.creating ? (
          <div className="empty">
            {state.focusMode
              ? 'No important open questions right now.'
              : 'Your tree is empty.'}
            <br />
            Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> or click the orb to capture a
            thought.
            <br />
            Drag questions from the Inbox into this tree.
          </div>
        ) : (
          <Branch items={forest} parentId={null} />
        )}
        <div
          data-root-drop
          className={`root-drop ${target?.kind === 'root-end' ? 'active' : ''}`}
          onDoubleClick={(event) => {
            event.stopPropagation()
            store.beginCreate(null, forest.length)
          }}
        />
      </div>
    </section>
  )
}
