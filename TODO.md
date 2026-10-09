# TODO

Ordered by what the product actually needs next. P0 = the MVP is not done
without it. P1 = the experience is noticeably incomplete without it. P2 = polish
and scope that is deliberately deferred.

## P0 — MVP blockers

_All P0 items are complete. See `PROJECT_STATE.md` for the verification list._

## P1 — Required for a good MVP

- [ ] **Persist undo history** — undo currently lives in memory and is per
  window, so it is lost on restart and does not cover a capture made from the
  orb. Decide whether that is acceptable or move history into SQLite.
- [ ] **Multi-select drag in the tree** — the Inbox supports multi-select and
  bulk filing; the tree only drags one node at a time. (`placeMutation` already
  handles a list of ids.)
- [ ] **Auto-scroll while dragging** near the top/bottom of a panel.
- [ ] **Large-tree performance** — the tree renders every visible row. Fine at
  hundreds of nodes; needs virtualisation before thousands.

## P2 — Deferred by design

- [ ] Markdown export — getting a conclusion out into writing or sharing.
- [ ] Collapse-all / expand-all.
- [ ] Per-node "open questions" count on the tree row.
- [ ] Drag a node from the tree back into the Inbox.
- [ ] Settings: choose the orb's default edge, disable auto-peek.
- [ ] Remember window size/position for the main window.
- [ ] Show the reason on the tree row as a tooltip.
- [ ] Keyboard: multi-select with Shift+Arrow, range delete.
- [ ] A cross-branch link currently shows as a `⇄` badge and in the detail
  panel; consider a hover preview that names the linked questions.

## Done — the E2E harness

- [x] **A real-browser Playwright harness** (`pnpm test:e2e`). `pnpm dev` now
  opens the app in an ordinary browser, where it runs on `MemoryPersistence`
  instead of the Tauri shell; the suite drives that real UI. Seven specs pin
  the behaviours that shipped broken and were invisible to the unit tests:
  capture → Inbox and not the tree, the capture bar being on screen, filing
  raising a *clickable* "Why here?", an empty tree accepting a drop, the Focus
  panel's undo/redo actually doing something, `Ctrl+P` revealing a node inside
  a collapsed ancestor, and the header theme switch reaching the document.
  A shared guard fails any test on an uncaught exception, an unhandled
  rejection or a non-allow-listed `console.error` — which is the whole point,
  since "the click silently threw and nothing happened" was the most common
  bug shape here.
- [x] Fixed: in a plain browser every load threw
  `Cannot read properties of undefined (reading 'invoke')` — the shell calls
  were unguarded. The harness caught this on its first run.

## Done — Phase 8 (the six gaps around the core loop)

- [x] **Search** (`Ctrl+P`) over questions, notes, conclusions and reasons.
- [x] **Review** — an uncounted look back at older captures, unconcluded notes,
  unexplained relations and unfiled items.
- [x] **Conclusions** view.
- [x] **Capture context** — the foreground app and window title are recorded.
- [x] **Import JSON** (undoable) and **restore from a rotating backup**.
- [x] **Cross-branch relations** — a question can link to any other question.
- [x] Light theme + system theme.
- [x] Fixed: the rotating backup now checkpoints the WAL before copying, so a
  backup can no longer be missing the previous session.

## Done — the quiet surface (D036)

- [x] The capture box was 780px wide to fit the shortcut hint inside it; the
  hint is now the input's tooltip, and the box is 560px.
- [x] 「关系」 meant both the parent relation and the cross-branch link in
  Chinese; the parent relation is now 「归属」, links stay 「关联」.
- [x] The Inbox's drag hint was permanent; it now shows only in the empty state.
- [x] The detail panel's 关联 block was rendered for every question, even with
  no links; it now appears only when there is one, leaving just the add action.

## Explicitly out of scope (see §17 of the brief)

Accounts, cloud sync, collaboration, AI summarisation/classification, RAG,
embeddings, vector databases, agents, MCP, browser extension, mobile, a
Markdown editor, templates, database views, Gantt, calendar, knowledge graph,
rich text.
