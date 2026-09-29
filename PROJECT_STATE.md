# Project State

**ThoughtTree** — a local-first Thinking Tracker.
*Capture freely. Organize deliberately. Focus relentlessly.*

Last updated: 2026-09-28

---

## Current Goal

Phase 1–5 of the brief are implemented and verified, and Phase 6 (reliability)
and Phase 7 (polish) are partly done. The MVP definition of done (brief §24) is
met. The next milestone is closing the P1 list in `TODO.md`, starting with
capture context and persisted undo history.

---

## Architecture at a glance

```
src/                        React front end (no framework beyond React)
  domain/                   Pure, tested core — no React, no I/O
    types.ts                Node / Edge / Changes / RelationType
    tree.ts                 forest building, ancestry, cycle checks, ordering
    mutations.ts            every edit as a reversible { forward, backward }
    changes.ts              the reducer; mirrors the SQL exactly
    focus.ts                Focus Mode selection and tree filtering
    relations.ts            relation types, "explained?" bookkeeping
  storage/                  Persistence boundary
    persistence.ts          interface
    tauri-persistence.ts    SQLite via IPC + cross-window broadcast
    memory-persistence.ts   in-memory, used by the whole test suite
  state/
    store.ts                AppStore: state, history, optimistic writes
    selectors.ts            memoised views
  components/               UI (App, Header, TreePanel, InboxPanel,
                            FocusPanel, DetailPanel, CaptureBar,
                            WhyHerePopover, Toast, ShortcutHelp, dnd)
  orb/                      floating orb window
  capture/                  quick capture window
  hooks/useKeyboard.ts      in-app keyboard workflow

src-tauri/                  Rust shell
  db.rs                     schema, migrations, the single write path
  commands.rs               db_load / db_apply / settings / export
  windows.rs                orb geometry, capture window, shortcut, watchdog
  tray.rs                   tray icon
  platform.rs               the few Windows-specific window fixes
  models.rs                 Node / Edge / Changes (mirrors the TS types)
```

### The data model

`Node { id, text, created_at, updated_at, priority, status, parent_id,
position, note, conclusion, inbox, collapsed, source_app, source_title }`

- `priority`: `normal | important`
- `status`: `open | later | done | archived`
- `inbox`: true until the thought is filed into the tree

`Edge { id, from_node, to_node, relation_type, reason, created_at }`
— `from_node` is the parent, `to_node` the child. A node has at most one
incoming edge. `relation_type` is one of `decompose | answer | support |
challenge | depends_on`.

### The write path

Every edit becomes a `Mutation { label, forward, backward }` built by a pure
function in `domain/mutations.ts`. The store applies `forward` to memory
immediately (optimistic), pushes the mutation onto the undo stack, and hands
`forward` to `db_apply`, which writes it in one SQLite transaction. On failure
the store applies `backward` and raises an error toast. Successful writes are
broadcast to the other windows so the orb, the capture window and the main
window never disagree.

---

## Completed

**Phase 1 — skeleton**
- Tauri 2 + React 19 + TypeScript + Vite project, Windows-first.
- SQLite via `rusqlite` (bundled), WAL, `synchronous=NORMAL`, versioned schema.
- Node / Edge model with 5 relation types and a documented reducer.
- Inbox and tree, both persisted.

**Phase 2 — capture**
- Floating orb: 64×64 circle, always on top, draggable, snaps to the nearest
  screen edge, remembers its position, slides mostly off-screen when idle and
  returns on hover, right-click opens the main window.
- Global shortcut quick capture (`Alt+Space` by default, rebindable in the UI,
  empty disables it). A second press while it is focused hides it again.
- Quick capture window: one input, `Enter` saves, `Esc` cancels, it hides itself
  when it loses focus with nothing typed.
- In-app capture bar with `Ctrl+Shift+C`.

**Phase 3 — organise**
- Drag and drop with before / after / inside drop targets and a live indicator.
- Multi-level tree, expand/collapse, keyboard navigation.
- Inline create (`Enter` = sibling, `Tab` = child) and inline rename (`F2`).
- "Why here?" prompt on every re-parent: relation type + a single-line reason,
  with *Skip for now*.
- `⚠ Unexplained` filter to sweep up every relation that has no reason.

**Phase 4 — triage**
- `★ Important` (click, `Ctrl+I`, or bulk from the Inbox).
- `Later` (dimmed, toggleable), `Done` (dimmed, toggleable), `Archived` (out of
  the Inbox, hidden unless the filter is on).
- Inbox multi-select with bulk Important / Later / Open / Archive / Delete.

**Phase 5 — focus**
- Focus Mode shows the important, open questions in the tree as a numbered list,
  and filters the tree to those branches plus the ancestors that give them
  context. It reports how many thoughts are still waiting in the Inbox.

**Phase 6 — reliability (partial)**
- Undo / redo over a 200-entry history, with labels surfaced in the UI.
- Write failures roll the change back and say so.
- Rotating database backup on every launch (5 kept).
- Export JSON through a native save dialog.
- Single-instance-free cross-window consistency via changeset broadcast.
- **Packaged and verified**: `pnpm app:build` produces
  `ThoughtTree_0.1.0_x64-setup.exe` (1.78 MB) plus a 4.5 MB standalone binary.
  The installed build was run and checked end to end — it opens the database,
  loads existing data, accepts a new capture and writes it to SQLite.

**Phase 7 — experience polish (partial)**
- Bilingual UI (English / 中文) with a switcher in *Keys & settings*; the
  language defaults to the system language and is remembered. All labels, the
  relation names, undo labels and toasts are translated; the domain layer only
  carries translation keys.
- Layout reads Inbox → Tree → Detail, with the tree given the widest column.
- `E` opens "Why here?" from the keyboard.

**Quality**
- 67 front end tests (domain + store, including the brief's integration cases:
  Capture → Inbox, Inbox → Tree, Tree drag → Relation, Relation → Why Here,
  Important → Focus, Done → hide/show, plus write-failure rollback,
  cross-window sync, inbox/tree separation and language switching).
- 5 Rust tests over the storage layer (create, upsert, cascade delete, one edge
  per child, settings).

### Bugs found by driving the real app (all fixed)

Packaging and then exercising the installed build — rather than trusting the
unit tests — surfaced six defects that no amount of store-level testing would
have caught:

| # | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| 1 | Packaged build died on launch: *state not managed* | Tauri creates config windows before the setup hook; embedded assets boot in milliseconds | D016 |
| 2 | IME users could not type: Enter cut the thought short | every Enter/Escape handler ignored composition | D015 |
| 3 | Unfiled captures appeared in the tree as well as the Inbox | `inbox` was modelled as "parentless" | D007 |
| 4 | The bottom capture bar was invisible | window taller than the screen, **and** the bar shared the panels' background colour | D018, D019 |
| 5 | "Why here?" could not be clicked at all | the click-outside scrim had a higher z-index than the popover | D020 |
| 6 | Dragging into an empty tree did nothing | the only drop target was a 22px strip; the empty state was not droppable | — |

---

## In Progress

Nothing is half-finished. The P1 list in `TODO.md` is the queue.

---

## Known Issues

1. **The main window can start minimized on this machine.** Something in the
   environment minimizes the freshly created window a few seconds after launch,
   intermittently and with no accompanying window event. `watch_main_window`
   re-asserts it for the first 20 seconds after launch, which resolves it in
   practice. Root cause not identified; it does not reproduce on demand.
2. **Undo is per-window and in memory.** A capture made from the orb cannot be
   undone from the main window, and nothing is undoable after a restart.
3. **Capture context is not collected.** `source_app` / `source_title` are always
   null (schema and plumbing are in place).
4. **No tree virtualisation.** Rendering cost grows linearly with visible rows.
5. **Drag does not auto-scroll** when a drop target is off-screen.
6. The orb's idle "peek" and the freeform positions are only verified on a single
   monitor.
7. **The orb is created before the database is managed** (it has to be, so the
   app always has a window). This is safe only because the orb's page never calls
   a database command; keep it that way, or move it into `setup` too.
8. **The bottom capture bar may still sit off the bottom edge.** It is confirmed
   to render (a temporary red background proved it) and it now has a distinct
   colour, but on this 150%-scaled display the main window's real painted extent
   is larger than `outer_size()` reports, so the size clamp in `fit_main_window`
   cannot be trusted to bring it on screen. Users on such a display should use
   `Alt+Space` (the floating capture window) instead. Fixing this properly needs
   the window measured in the same coordinate space the layout uses.
9. **The orb's appearance is unverified in this environment.** Its window is
   present, visible, topmost and correctly sized, but its pixels never appear in
   a screen capture — even with an opaque magenta background, and even with a
   plain-HTML colour block on the page. That points at layered-window
   compositing not reaching a BitBlt in a remote session rather than at the app.
   It did render visibly in one earlier session. Verify on a normal desktop.
10. **Automated UI-driving is unreliable in this environment.** Synthesised
   keystrokes are mangled by the active IME and absolute click coordinates
   disagree with `GetClientRect` (this shell is DPI-unaware, the app is
   per-monitor aware). Flows were therefore verified with a mix of real input,
   database assertions and screenshots. A real-browser E2E harness
   (Playwright against the dev server, with the Tauri API stubbed) would make
   this repeatable — see `TODO.md`.

---

## Next

1. Capture context (foreground app + window title) — small, self-contained, and
   the last piece of §4.
2. Decide the fate of undo history: persist it, or accept and document the
   limitation.
3. Multi-select drag in the tree.
4. Auto-scroll during drag.
5. Tree virtualisation.

---

## Product Decisions

See `DECISIONS.md` for the full log with reasoning. The load-bearing ones:

- **Tauri 2, not Electron** (D001).
- **One atomic changeset as the only write primitive** (D003) — this is what
  makes optimistic UI, undo and multi-window sync cheap.
- **`inbox` is an explicit flag** (D007) — without it an unfiled capture leaks
  into the tree.
- **Re-parenting resets the reason; reordering does not** (D008).
- **"Why here?" never blocks** (D009) — the debt stays visible under the
  `⚠ Unexplained` filter instead.
- **IME composition is never treated as submit** (D015).

---

## How to verify the MVP (brief §24)

| Requirement | Where |
| --- | --- |
| 1. Starts on Windows | `pnpm app:dev`, or `pnpm app:build` |
| 2. Local persistence | `%APPDATA%\app.thoughttree.desktop\thoughttree.db` |
| 3. The orb runs | 64×64 circle, always on top, snaps to the screen edge |
| 4. Orb → Quick Capture | click the orb |
| 5. Global shortcut → Quick Capture | `Alt+Space` from any app |
| 6. Capture lands in the Inbox | bottom capture bar or the orb |
| 7. Inbox → Tree | drag an item onto a tree row |
| 8. Multi-level tree | `Tab` to nest; keep going |
| 9. Re-organise by dragging | drag a row: before / after / inside |
| 10. Why Here after a relation | the prompt appears on every re-parent |
| 11. Important | `Ctrl+I` or the ★ |
| 12. Later | `Ctrl+L`, or the filter chip |
| 13. Done | `Ctrl+K`, or the filter chip |
| 14. Focus Mode | the *Focus* button, or `Ctrl+Shift+F` |
| 15. Data survives a restart | reopen the app |
| 16. No noticeable stalls | optimistic UI; no loading states anywhere |
| 17. Automated tests over the core flows | `pnpm test`, `pnpm test:rust` |
