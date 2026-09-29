# TODO

Ordered by what the product actually needs next. P0 = the MVP is not done
without it. P1 = the experience is noticeably incomplete without it. P2 = polish
and scope that is deliberately deferred.

## P0 — MVP blockers

_All P0 items are complete. See `PROJECT_STATE.md` for the verification list._

## P1 — Required for a good MVP

- [ ] **A real-browser E2E harness.** Drive the actual UI with Playwright against
  the Vite dev server, with the Tauri API stubbed by `MemoryPersistence`
  (gated behind `import.meta.env.DEV`). This is the only reliable way to
  regression-test drag-and-drop, the relation prompt and the capture bar —
  all three of which shipped broken despite a green unit-test suite, and it is
  the only item in this list that would have caught the bugs found by hand.
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

## Explicitly out of scope (see §17 of the brief)

Accounts, cloud sync, collaboration, AI summarisation/classification, RAG,
embeddings, vector databases, agents, MCP, browser extension, mobile, a
Markdown editor, templates, database views, Gantt, calendar, knowledge graph,
rich text.
