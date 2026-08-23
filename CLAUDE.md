# Repository guide

Unity Log Viewer: a Tauri 2 desktop app (React + TypeScript front end, Rust core)
for reading multi-gigabyte Unity player logs. Windows-only today — every
platform-specific path sits behind `#[cfg(target_os = "windows")]`.

## Commands

Run from the repository root.

```
npx tsc --noEmit                                              # type check
npm test                                                      # Vitest
cargo test --workspace --manifest-path src-tauri/Cargo.toml   # --workspace, or ulv-core is skipped
npm run tauri dev                                             # dev run
npm run tauri build                                           # package (needs the updater signing key)
```

CI runs the same checks on Ubuntu and Windows for every push and pull request.

## Where things live

| Path | Owns |
| --- | --- |
| `src/App.tsx` | State and the cross-cutting effects — the glue layer, and where the bugs come from |
| `src/view/*.tsx` | Presentational components (home page, toolbar, list, scrollbar, detail panel, notice bar). Explicit props, no state, no effects — each with its own `.css` next to it |
| `src/lib/scroll.ts` | Row-unit scroll and marker-map geometry (pure, tested) |
| `src/lib/filter.ts` | Query parsing, highlight ranges, page-chunk math (pure, tested) |
| `src/lib/settings.ts` | Settings shape, defaults, and the merge/clamp of stored values |
| `src/lib/api.ts` | The only place that calls `invoke` — one function per IPC command |
| `src/locales/en.ts` | Source language; the six translations are enforced by the `Messages` type |
| `src-tauri/src/lib.rs` | App state, every `#[tauri::command]`, live tail |
| `src-tauri/src/query.rs` | Filter compilation, grouping, marker map (pure, tested) |
| `src-tauri/src/paths.rs` | Project-root inference and path resolution |
| `src-tauri/core/` | `ulv-core`: the parser. No Tauri imports, no external dependencies |

## Where to change what

- how something looks → the matching `view/*.tsx` and its `.css`; `App.css` holds only
  theme variables, the reset, and genuinely shared classes
- scrolling, scrollbar, markers → `lib/scroll.ts` plus the scroll section of `App.tsx`
- search and filter behaviour → `lib/filter.ts`, and `query.rs` for the Rust half
- a new setting → `Settings`, `DEFAULTS` and `mergeSettings` in `lib/settings.ts`, then
  `SettingsModal.tsx` and `settings.test.ts`
- new UI text → `locales/en.ts`; the other six locales fail to compile until translated
- a new IPC command → define and register it in `lib.rs`, then add its binding to `lib/api.ts`
- log parsing → `src-tauri/core/src/parser.rs`

`F-nn` tags in comments are feature ids from an internal feature list — opaque labels,
nothing to look up.

## Invariants

Each of these exists because breaking it caused a regression. New code keeps them.

- **No full-height spacer in the list.** The engine clamps element height at
  33,554,432px, silently: a `total * rowH` spacer made every row past ~1.15M
  unreachable. Rows are positioned relative to the scroll row, and the scrollbar is
  drawn by hand.
- **One scroll authority.** The position is the `scrollRow` state, in fractional rows.
  Scroll only through `setRow` / `scrollToIndex`, and pass the current total in rather
  than waiting for state to catch up.
- **The marker map shares the thumb's coordinate span** (`markBuckets` / `markOffset`),
  never the full track — the minimum thumb height desynchronises the two. Buckets store
  counts, not flags: one bucket can cover thousands of rows.
- **The front end never holds the whole log.** New list-like UI pages through IPC.
- **JS never sends `hash` back to Rust** — u64 loses precision in JSON. Key by entry `id`.
- **Live tail may only replace the last entry and append.** Ids of earlier entries never
  change; selection, bookmarks and anchoring all depend on that.
- **Query IPC takes `FilterParams`.** An empty `levels` array means show nothing — that
  is explicit, not a fallback to "show everything".
- **No hard-coded colours or font sizes.** CSS variables only, and a new variable needs a
  value in all three `[data-theme]` blocks. Text uses `var(--ui-fs)` / `var(--list-fs)`.
- **No bare UI strings.** Use `t("key")` and add the key to `locales/en.ts`. Rust error
  strings stay English — they are diagnostics.
- **Everything that renders entry text goes through `hl()`**, or search hits stop
  highlighting there.
- **Both render branches.** `App` shows a home page when no file is open and the viewer
  otherwise; global UI such as notices must render in both.
- **`view/` components stay presentational.** They take props and render; state and
  effects live in `App.tsx`. An effect may only move out with the state it exclusively
  owns — anything reading two or more of filter, collapse, active file, selection,
  total or scroll position stays where it is.
- **Windows: no flashing consoles.** Spawned processes use `hidden_output()` or
  `CREATE_NO_WINDOW`.
- **Never rename the executable or the product name.** The `.log` file association stores
  the executable's absolute path, and `heal_log_association()` repairs it at startup.

## Commits

English, Conventional Commits: `type: description` or `type(scope): description`.
Release notes are generated from these, so a commit that does not match the format is
dropped from them. Types in use: `feat`, `fix`, `perf`, `ui`, `docs`, `refactor`, `ci`,
`build`, `test`, `chore`.
