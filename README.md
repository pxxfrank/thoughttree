# ThoughtTree

A local-first thinking tracker.

> Capture freely. Organize deliberately. Focus relentlessly.

You start with one question. It spawns five more. One of those spawns a rabbit
hole, and an hour later you have forgotten what you were originally trying to
solve. ThoughtTree is built for that exact failure: throw every thought into an
Inbox with zero friction, decide *later* where it belongs and why, and then
narrow back down to the two or three questions that actually matter right now.

It is not a knowledge base, not a mind map, and not a chat client. There is no
account, no cloud, no network call, and no AI. Everything lives in a SQLite file
on your machine.

---

## Running it

### Prerequisites

- Windows 10/11 with the **WebView2 runtime** (preinstalled on Windows 11).
- **Node.js 20+** and **pnpm**.
- **Rust** (stable) with the `x86_64-pc-windows-msvc` target.
- **Visual Studio Build Tools** with the *Desktop development with C++*
  workload (this provides `link.exe`, `rc.exe` and the Windows SDK).

### Commands

```powershell
pnpm install
pnpm app:dev      # development, with hot reload
pnpm app:build    # production build + NSIS installer
```

Other useful scripts:

```powershell
pnpm test         # front end unit + integration tests (vitest)
pnpm test:rust    # storage layer tests (cargo test)
pnpm build        # typecheck + build the front end only
```

### If the Rust build cannot find a linker

`pnpm app:dev` and `pnpm test:rust` go through `scripts/run-rust.cjs`, which
sets up the MSVC environment before invoking cargo. It exists because some
Visual Studio installations ship without
`VC/Tools/MSVC/<version>/bin/Hostx64/x64/link.exe`; in that case the script puts
the x86-hosted x64 toolset (`bin/Hostx86/x64`, which produces identical x64
output) and the Windows SDK resource compiler on `PATH` after `vcvars64.bat` has
populated `INCLUDE` and `LIB`.

Set `THOUGHTTREE_SKIP_MSVC=1` to bypass it and use your own developer prompt.
Run with `THOUGHTTREE_DEBUG=1` to see which paths it resolved.

---

## Your data

Everything is stored at:

```
%APPDATA%\app.thoughttree.desktop\thoughttree.db
```

SQLite in WAL mode, written through a single transactional path. A rotating copy
is made in `backups\` on every launch (the five most recent are kept), and
**Export JSON** in *Keys & settings* writes the whole graph out.

---

## Keyboard

| Keys | Action |
| --- | --- |
| `Alt+Space` | Global quick capture, from any application |
| `Ctrl+Shift+C` | Focus the capture bar |
| `↑` `↓` | Move between questions |
| `←` `→` | Collapse / expand |
| `Enter` | New question below |
| `Tab` | New sub-question |
| `F2`, double-click | Rename |
| `Delete` | Delete a question and its subtree |
| `Ctrl+I` | Toggle ★ Important |
| `Ctrl+L` | Toggle Later |
| `Ctrl+K` | Toggle Done |
| `Ctrl+Shift+F` | Toggle Focus Mode |
| `Ctrl+Z`, `Ctrl+Shift+Z` | Undo, redo |
| `Esc` | Deselect, or dismiss a popover |

The global shortcut is configurable (or can be cleared) in *Keys & settings*.

---

## How the thinking is enforced

Edges between nodes are not just structure — they are judgements. Dragging a
question under another one opens **Why here?**, which asks you to pick a relation
type and write, in one line, why the two belong together.

It never blocks you: *Skip for now* is always available. But an unanswered
question is marked `⚠` and can be swept up later with the **⚠ Unexplained**
filter. The prompt is where the tool helps you notice that you have drifted, and
the filter is where it makes sure the debt is visible until you deal with it.

---

## Project documents

- [`PROJECT_STATE.md`](PROJECT_STATE.md) — what works, what is broken, what is next.
- [`TODO.md`](TODO.md) — the queue, by priority.
- [`DECISIONS.md`](DECISIONS.md) — every significant decision, with the reasoning
  and the trade-off accepted.
