# Decision Log

Every significant product or technical decision, with the reason and the cost
we accepted. Read this before proposing to change any of it.

---

## D001 — Tauri 2 instead of Electron

**Decision**: Build the desktop shell on Tauri 2 (Rust + WebView2) with a React
frontend.

**Reason**: The product's core promise is *instant*: cold start in a blink, a
quick-capture popup that is already on screen, modest memory. Electron ships a
full Chromium per app (100 MB+ installers, ~150 MB RSS before any of our code
runs). Tauri reuses the WebView2 runtime that is already part of Windows.

Tauri also gives us, natively and without extra plumbing: always-on-top
transparent windows (the orb), a global shortcut plugin, a tray icon, and a
clean Rust ↔ JS command boundary for SQLite.

**Trade-off**: Rust compile times are real (a cold Tauri build on this machine is
several minutes), and the toolchain needs a C++ linker. We accepted that in
exchange for the runtime characteristics that define the product.

**Date**: 2026-09-28

---

## D002 — SQLite via `rusqlite` in Rust, not a JS SQL plugin

**Decision**: Own the database in Rust with `rusqlite` (bundled SQLite).

**Reason**: We want WAL + `synchronous=NORMAL`, explicit schema migrations, and
one transactional write path. `tauri-plugin-sql` would have pushed query
construction and transactions into the frontend.

**Trade-off**: Every read/write crosses the IPC boundary. We mitigated it by
loading the whole dataset once at startup and treating SQLite purely as durable
storage (see D003).

**Date**: 2026-09-28

---

## D003 — One write primitive: an atomic changeset

**Decision**: The Rust side exposes exactly one mutation command, `db_apply`,
taking `{ upsert_nodes, upsert_edges, delete_nodes, delete_edges }`. All domain
logic — validation, ordering, cascade rules — lives in the tested TypeScript
domain layer, and the frontend generates the entity objects (ids, timestamps).

**Reason**:
1. **Optimistic UI for free.** The UI applies the changeset to memory
   immediately, then persists it. Nothing ever waits on a round trip.
2. **Undo/redo for free.** A `Mutation` is `{ forward, backward }` — two
   changesets. Undo is just applying `backward`.
3. **Multi-window sync for free.** Broadcasting the changeset keeps the main
   window, the orb and the capture window consistent without any refetching.

**Trade-off**: A frontend bug could write an inconsistent graph. We keep the risk
low because the reducer (`applyChanges`) mirrors the SQL exactly and is unit
tested, and because the domain layer rejects structurally invalid moves
(cycles, self-parenting) before a changeset is ever built.

**Date**: 2026-09-28

---

## D004 — Explicit sibling renumbering instead of fractional positions

**Decision**: Sibling order is `position = index * 1000`. Moving a node rewrites
the affected sibling list.

**Reason**: Fractional ranking ("insert between 1000 and 2000 → 1500") avoids
writing extra rows but makes multi-node moves and index arithmetic genuinely
hard to reason about, and it degrades after enough insertions. Sibling lists are
short, so renumbering is cheap, always exact, and trivial to test.

**Trade-off**: A drag writes more rows than strictly necessary. Irrelevant at
this scale.

**Date**: 2026-09-28

---

## D005 — Custom pointer-based drag and drop

**Decision**: Implement tree drag-and-drop on pointer events rather than using
the native HTML5 drag API or a library.

**Reason**: Dropping a question needs three distinct outcomes — *before*,
*after*, and *inside* — and the inside/outside decision has to be made from the
pointer's vertical position within a row. The HTML5 drag API hides that
precision, and a full sortable-tree library would be a large dependency for one
interaction.

**Trade-off**: We own the drag code (~150 lines) and its edge cases.

**Date**: 2026-09-28

---

## D006 — A framework-free store bound with `useSyncExternalStore`

**Decision**: The app state lives in a plain `AppStore` class with no React
dependency; React subscribes via `useSyncExternalStore`.

**Reason**: All the interesting logic (mutations, history, optimistic writes,
rollback) becomes testable without a DOM or a testing library. The test suite
drives the store directly through an in-memory `Persistence` implementation.

**Trade-off**: A few more lines of wiring than a state library. Worth it.

**Date**: 2026-09-28

---

## D007 — `inbox` is a flag, not "parentless"

**Decision**: A captured thought carries `inbox = true` until it is placed in the
tree. The tree renders only nodes with `inbox = false`.

**Reason**: Without the flag, an unfiled capture is indistinguishable from a
top-level question and shows up in both the Inbox and the tree (this was a real
bug we hit and fixed). The flag also lets "Archive" remove a thought from triage
without inventing a fake parent.

**Date**: 2026-09-28

---

## D008 — The relation type is reset whenever the parent changes

**Decision**: Moving a question under a *different* parent resets its relation to
`decompose` with no reason and opens the "Why here?" prompt. Reordering under the
same parent leaves the existing judgement untouched.

**Reason**: The stated reason is a judgement about a *specific* parent-child
pair. Carrying it across a reparent would be a lie. Reordering is not a new
judgement, so it must not nag the user again.

**Date**: 2026-09-28

---

## D009 — "Why here?" never blocks, but never disappears either

**Decision**: Skipping the prompt is allowed. The node is marked with ⚠, and a
filter (`⚠ Unexplained`) collects every relation that has no reason yet.

**Reason**: Blocking capture or organisation is the one thing this product must
not do. But the philosophy — *edges are judgements* — is enforced by keeping the
debt visible and reviewable in one place.

**Date**: 2026-09-28

---

## D010 — Strip `WS_CAPTION` from the undecorated windows

**Decision**: On Windows, clear `WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX |
WS_MAXIMIZEBOX` on the orb and capture windows via `SetWindowLongW`.

**Reason**: Tauri's `decorations: false` still leaves those style bits set, and
Windows then refuses to make a window narrower than `SM_CXMINTRACK` (136 px on a
default desktop). The 64×64 orb was silently becoming a 136×64 slab.

The strip must run **after** `show()`: showing a window re-applies Tauri's window
attributes, so stripping earlier is undone.

**Trade-off**: ~30 lines of `unsafe` FFI, confined to `src-tauri/src/platform.rs`.

**Date**: 2026-09-28

---

## D011 — Global quick capture defaults to `Alt+Space`

**Decision**: `Alt+Space`, configurable in *Keys* settings, empty string
disables it.

**Reason**: Reachable with one hand, unused by most Windows apps (it is the
system window menu, which only applies to the focused window).

**Trade-off**: It shadows the Windows system menu on the focused window. Users
who rely on that can rebind or clear it.

**Date**: 2026-09-28

---

## D012 — Back up the database on every launch

**Decision**: Copy the SQLite file into `backups/` at startup and keep the five
most recent copies.

**Reason**: The cheapest possible insurance against a bad edit or a crash. Data
loss is the one failure a local-first tool cannot recover from on its own.

**Date**: 2026-09-28

---

## D013 — A bounded startup watchdog for the main window

**Decision**: For the first 20 seconds after launch, re-assert the main window if
it has become minimized or hidden.

**Reason**: On this machine the freshly created main window was intermittently
minimized a few seconds after launch, with no accompanying window event — i.e.
by the environment, not by our code. (Tauri's own `unminimize()` is not enough:
it flips an internal flag and can leave the native window iconic.) A visible main
window on launch is the one thing the app must never get wrong, and the check is
bounded and cheap.

**Trade-off**: If the user deliberately minimizes the main window within the first
20 seconds of a launch, it pops back once. The system tray icon exists so the
window can always be recovered regardless.

**Date**: 2026-09-28

---

## D014 — A system tray icon, despite the orb

**Decision**: Ship a tray icon with *Open ThoughtTree*, *Quick capture* and
*Quit*.

**Reason**: Closing the main window keeps the app running (it is a background
utility), so there must be a discoverable way back. The orb is the *capture*
affordance and never shows menu text; right-clicking it is not discoverable
enough to be the only path.

**Date**: 2026-09-28

---

## D015 — Guard every Enter/Escape handler against IME composition

**Decision**: All key handlers bail out while `isComposing` is true (or
`keyCode === 229`).

**Reason**: An early build swallowed the Enter that confirms a Chinese IME
candidate and saved a half-typed thought — observed in a real session. For
Chinese, Japanese and Korean users this would have made quick capture unusable.

**Date**: 2026-09-28
