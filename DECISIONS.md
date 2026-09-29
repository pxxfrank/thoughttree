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

---

## D016 — The main and capture windows are created in `setup`, not in the config

**Decision**: `tauri.conf.json` declares only the orb. The main window and the
quick-capture window are built with `WebviewWindowBuilder` inside the `setup`
hook, *after* `app.manage(AppDb)`.

**Reason**: Tauri builds the windows declared in the config **before** the setup
hook runs. The first packaged build therefore failed with

> state not managed for field `state` on command `db_load`

because the embedded front end boots from local assets and fires `db_load`
within milliseconds — much faster than the same page served by the Vite dev
server, which is why this only ever appeared in a release build. Creating the
windows after the database is managed removes the race at its root, rather than
papering over it with retries in the front end.

The orb is deliberately left in the config: it is `visible: false`, it is needed
as the very first window (so the app always has one), and its page never talks to
the database.

**Trade-off**: Window geometry now lives in Rust instead of JSON. Worth it — the
alternative is a startup-ordering bug that only reproduces in production.

**Date**: 2026-09-29

---

## D017 — A database that cannot be opened must say so

**Decision**: `AppDb` holds `Option<Connection>` plus the open error, and every
command goes through `with` / `with_mut`.

**Reason**: Failing to open the database used to abort the setup hook, leaving
`AppDb` unmanaged and every command failing with Tauri's internal
"state not managed" message. That tells the user nothing about what went wrong,
in exactly the situation where they most need to know.

**Date**: 2026-09-29

---

## D018 — The main window is clamped to the monitor, and the capture bar is distinct

**Decision**: After creating the main window (and again shortly after it is
shown) clamp its size to the current monitor using *physical* units. Give the
capture bar a lighter background than the three panels.

**Reason**: The window was created at a fixed 1200x780 *logical* pixels, which on
a 150%-scaled display is 1800x1170 physical — taller than the work area. The
bottom capture bar therefore rendered against the panel colour, at the very
bottom edge. Separately, the bar used `var(--panel)` — exactly the panels'
colour — so it was invisible even when on screen.

**Status — partially verified.** The colour change is straightforward and was
confirmed live with a temporary red probe. The size clamp is **not confirmed**:
in this environment `outer_size()` / `GetWindowRect` report a height (773) that
does not match the window's actual painted extent (~795+), so the clamp may be
computing against a value that does not describe reality. It is harmless and
principled, but treat it as unproven. See `PROJECT_STATE.md` → Known Issues.

**Date**: 2026-09-29

---

## D020 — A popover is nested inside its click-outside scrim

**Decision**: `WhyHerePopover` renders the popover as a *child* of the scrim
element, not as a sibling.

**Reason**: As siblings they were both `position: fixed`, and the scrim had a
higher `z-index` (80 vs 60). So the scrim painted over the prompt: the input,
the relation chips and both buttons were unclickable, and every click dismissed
the dialog instead. Nesting makes the order structural — a child always paints
above and receives input before its parent — so the class of bug cannot recur.
The z-index values were then free to express intent rather than correctness.

**Date**: 2026-09-29

---

## D021 — The Inbox sits on the left

**Decision**: The workspace reads Inbox → Tree → Detail, with the tree given the
widest column.

**Reason**: The original layout came from the brief (tree left, Inbox middle).
In use, the left-to-right order should follow the work: unfiled captures come
in on the left, get organised into the tree in the middle, and are examined on
the right. The tree is also where sustained attention goes, so it gets the most
room; the Inbox is a queue and needs less.

**Trade-off**: It departs from §15 of the brief, which explicitly allowed the
layout to be adjusted for a better experience.

**Date**: 2026-09-29

---

## D022 — Translation keys live in the domain, text lives in the UI

**Decision**: `Mutation` carries `labelKey` (+ optional params) instead of an
English `label`; `RELATION_TYPES` is a list of values and the labels live in
`src/i18n`. The store holds `locale` and persists it.

**Reason**: The domain layer has no business owning display strings, and undo
labels, relation names and validation messages all need translating. Keeping
only keys in the domain means adding a language is a change to one file plus the
components, and a missing key shows up as an obvious token rather than a blank
label.

**Language choice**: defaults to the system language on first run
(`navigator.language`), then remembers what the user picked.

**Date**: 2026-09-29

---

## D023 — "Why here?" is reachable from the keyboard

**Decision**: Pressing `E` on a nested question opens the relation prompt.

**Reason**: The prompt was only reachable by dragging, or by finding a button in
the detail panel. A question whose relation is unexplained needs a keyboard
route — the whole point of the "unexplained relations" filter is to sweep them
up in a batch, and that is a keyboard-shaped job.

**Date**: 2026-09-29

---

## D024 — A light theme, and flomo's green as the single accent

**Decision**: Add a light theme (`light` / `dark` / `system`, default system,
persisted). Move every colour in the app into design tokens so a theme is one
block of overrides. Replace the indigo accent with flomo's green in *both*
themes.

**Reason**: The app was dark-only. A light theme is not a second stylesheet —
it is only maintainable if every colour already resolves to a token, so the
tokenisation came first (47 literal colours in `styles.css` alone, plus the orb
and the quick-capture window).

The accent is green in both themes rather than a per-theme hue: a brand that
changes colour with the theme reads as two products. The green is tuned per
theme for contrast — `#35d08a` on dark, `#0fa968` on light — which is a
legitimate reason for the values to differ even though the hue does not.

**Also**: the native window chrome follows the theme (`set_app_theme`), because
a white UI under a black title bar looks broken. The orb and the quick-capture
window are separate webviews, so they pick the theme up from `localStorage`,
which all Tauri windows share, and react to the `storage` event.

**Trade-off**: this replaced a colour the previous build had used throughout.
The user asked for a flomo-flavoured light theme, and a green accent is most of
what "flomo" means visually.

**Date**: 2026-09-29

---

## D025 — The orb glyph is smaller; its window is not

**Decision**: Keep the orb window at 64x64 and shrink the glyph inside it from
58% to 44%. Keep all three windows created in `setup` rather than in the config.

**Reason**: The request was for a smaller *icon*. The window is the hit target,
and 64px is already the smaller end of comfortable; shrinking it further would
trade appearance for misclicks. Shrinking the glyph gives the quieter, lighter
mark without that cost.

Windows are now created uniformly in `setup` (in order: orb, main, capture).
Mixing config-declared and setup-created windows left the orb unverified.

**Unverified**: the orb's *appearance* could not be confirmed in this
environment. The window is present, visible, topmost and correctly sized, and
`IsWindowVisible` is true, but its pixels never appear in a screen capture —
including when its background was temporarily set to opaque magenta and when a
plain-HTML colour block was added to the page. That is the signature of a
layered (transparent) window not being composited into a BitBlt in a remote
session, i.e. a limitation of the measurement, not necessarily of the app. It
rendered visibly in an earlier session, so treat this as unconfirmed rather than
broken. See `PROJECT_STATE.md` → Known Issues.

**Date**: 2026-09-29

---

## D026 — The default global shortcut is not Alt+Space

**Decision**: The default quick-capture shortcut becomes `Ctrl+Shift+Space`.

**Reason**: `Alt+Space` is Windows' own system-menu accelerator. A
`RegisterHotKey` on it **succeeds** and then never fires, so the app silently
lost the primary way in — nothing was logged anywhere the user would see, and
the window simply never appeared.

Found by pressing the shortcut and watching the database: the quick-capture
window never became visible, while clicking the orb did open it and a capture
through the orb saved correctly and appeared in the list. Switching the default
to `Ctrl+Shift+Space` made the same synthetic keypress open the window.

**Also fixed**: the app now re-checks the shortcut shortly after startup (which
also serves as a retry, since a previous instance may still be holding the
hotkey) and tells the user plainly if it still cannot be registered — including
that the orb still works. Silent loss of the main input path is worse than any
message.

**Date**: 2026-09-29

---

## D027 — Rows are drag handles, so their text is not selectable

**Decision**: `user-select: none` on tree rows and inbox items, plus the whole
document while a drag is actually in flight.

**Reason**: A drag starts on the row's text, so sweeping the pointer across rows
painted a text selection behind the cursor — noisy, and it reads as the app
doing something unintended. The row is a handle, not a paragraph.

The second half matters because a drag crosses things that are *not* handles
(panel hints, empty space). Suppressing selection only on the handles would
still let a selection start mid-drag.

**Accepted cost**: you can no longer select a question's text in the tree or the
inbox to copy it. The detail panel's fields remain fully selectable, which is
where copying actually happens.

**Also fixed**: a domain rejection reached the user as untranslated English
inside a Chinese UI ("无法完成该操作：A question cannot be moved inside itself").
`DomainError` now carries a translation key rather than a message — the domain
layer should never own display text, and an error path is still user-facing.

**Date**: 2026-09-29

---

## D028 — Store methods are bound in the constructor

**Decision**: The `AppStore` constructor binds every method on its prototype to
the instance.

**Reason**: Methods were handed to React as bare references —
`onClick={store.toggleFocusMode}` — and React invokes a handler without a
receiver, so `this` is `undefined` inside it. The handler threw
`TypeError: Cannot read properties of undefined (reading 'patch')` and the click
did nothing. Nothing surfaced: not in the UI, not in the test suite, not in
review. The button simply appeared dead, and the only way to see it was to open
the webview console, which a packaged build does not have.

This is how the Focus button was reported: "clicking it does nothing". The
keyboard path worked throughout (`useKeyboard` calls `store.toggleFocusMode()`
with a receiver), which made it look like a filtering bug rather than a click
bug — and I chased the filtering logic for two rounds before checking how the
handler was actually invoked.

Binding the whole prototype once makes the class of bug impossible, rather than
fixing five call sites and leaving the trap for the next method. A regression
test calls the methods detached, which is exactly React's calling convention;
without the binding it fails with the same `TypeError`.

**Affected**: `toggleFocusMode`, `undo`, `redo`, `dismissToast`, `skipExplain`.
The last one matters historically: the earlier "Skip for now is stuck" report
had *two* causes — the popover was unreachable behind its scrim (D020) *and* its
handler would have thrown even if reached.

**Date**: 2026-09-29


