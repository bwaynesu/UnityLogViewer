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

## Writing (README and any user-facing doc)

The two READMEs are one document in two languages: same sections, same order, same
claims. Edit both, or neither.

House voice, in both languages:

- **No second person.** Not "your logs" / "folders you add" but "the logs" / "watch
  folders added by hand"; 不用「你的日誌」「你自己加入」,用「日誌」「自行加入」.
  The Windows dialog text ("Windows protected your PC") is quoted verbatim and exempt.
- **No filler pronoun subjects.** Start with the verb, or name the thing: "Parses the raw
  log into…", "This tool reads…" — not "It parses…". 中文用「此工具」或直接省略主語,
  不用「它」「這個工具」.
- **Cut every word that carries nothing**: "Unity's immediate-mode GUI" → "Unity
  immediate-mode GUI"; 「不同的定位」→「不同定位」,「一個快速的原生檢視器」→
  「快速的原生檢視器」.
- **Formal register over conversational.** 「也不需付費」→「亦不需付費」,「沒有遙測」→
  「無遙測」,「只讀取」→「僅讀取」,「不是 X」→「而非 X」.
- **Outcome first, mechanism never.** The README says what the user gets; it does not
  explain how it is implemented, which bug it fixed, or which engine limit was worked
  around. That belongs in comments and commit messages.
- **Result before cause before instruction.** The SmartScreen note reads: what happens →
  this is expected, and why → what to click.
- **No specifics that expire.** "The UI is localized" rather than a list of seven language
  names that goes stale the moment one is added.
- Prefer a noun phrase to a relative clause: "a copy-summary button for pasting into bug
  reports", not "a button to copy a summary so you can paste it into a bug report".

Development notes and code comments are a different register — they explain mechanism and
history, which is exactly what the README leaves out.

## Commits

English, Conventional Commits: `type: description` or `type(scope): description`.
Release notes are generated from these, so a commit that does not match the format is
dropped from them. Types in use: `feat`, `fix`, `perf`, `ui`, `docs`, `refactor`, `ci`,
`build`, `test`, `chore`.
