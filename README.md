# Unity Log Viewer

*Also in [繁體中文（台灣）](README.zh-TW.md).*

A desktop app for reading Unity `Player.log` files. It parses the raw log into structured, searchable entries, so large logs that stall a text editor open quickly and stay responsive.

`Player.log` has no timestamps and no level prefixes. In a text editor it is a flat wall of lines with stack traces broken across many rows. This tool rebuilds each entry with its stack trace, infers the severity, groups repeated messages, and lets you click a stack frame to open that file and line in your IDE.

![Unity Log Viewer](./docs/images/Preview.png)

## Why this exists

Player logs from a shipped game run to hundreds of megabytes and hundreds of thousands of lines. A general text editor gets sluggish at that size and shows none of the structure the format carries: call-site frames, exception blocks, the startup banner.

Most existing Unity log tools sit in a different niche:

- **In-game debug consoles** show logs live inside a running build, not the log file a tester sends you afterwards.
- **Older editor-window viewers** load the file but are built on Unity's immediate-mode GUI, so they bog down or crash on large logs.
- **SaaS crash collectors** work well but upload your logs to a third party and bill by volume.
- **The polished web viewers** are front-ends for paid, closed-source products.

This is the offline, local, open-source option: a fast native reader for a log file already on your disk, with nothing uploaded and no paywall.

*Longer write-up: [\[Tools\] Unity Log Viewer: No More Reading Player.log in a Text Editor](https://medium.com/@bwaynesu/tools-unity-log-viewer-no-more-reading-player-log-in-a-text-editor-31103c33cddd) (English and 繁體中文).*

## Features

**Opening a log** — several ways in:
- Associate the `.log` extension, then open a file by double-clicking it in Explorer.
- Drag a file onto the window.
- Pick from recent files, from Player.log files found under LocalLow, or from watch folders you add.
- Open from the command line (`UnityLogViewer <path>`); a second launch reuses the running window.

**Reading**
- Parses Player.log despite its missing timestamps and level prefixes, keeping multi-line stack traces attached to their entry.
- Infers the level (Log, Warning, Error, Assert, Exception).
- Collapses duplicate messages with an ×N count. Numbers in a message are masked, so spam that differs only in its numbers folds into one group.
- Detail panel with the full message, a formatted stack trace, and a copy button for the raw entry.
- Live tail: toggle **⏵Live** to follow a file the game is still writing. New entries parse incrementally, the list stays pinned to the bottom until you scroll up, and a rewritten log (game restart) reloads automatically.

**Finding**
- Search the message and stack frames together: space-separated terms are AND-matched, `-term` excludes, with case and regex toggles.
- Jump between errors (F8 / Shift+F8) and filter by level (1 / 2 / 3); the selected entry stays put when filters change.
- Bookmark entries (B or the ★ button) and jump back from the sidebar list; "Copy ref" copies a `file #entry` text reference for sharing.
- Flags native crash dumps (an `OUTPUTTING STACK TRACE` section) with a link to jump to it.

**IDE deep-linking**
- Click a `file:line` stack frame to open it in your IDE at that line, with no setup. It uses Unity's configured external script editor, then falls back through Visual Studio, Rider, and VS Code. A custom command template is available as an override.

**Triage**
- A system-info card from the log banner (Unity version, graphics API, GPU, VRAM, driver), with a button to copy a summary for bug reports.
- Whole-file level counts and a Top 10 of repeated errors, each clickable to jump to the entry.

**Comfort**
- Tabs, light/gray/dark themes, adjustable font size (Ctrl+scroll), and row tinting. Preferences are stored locally.
- UI in 7 languages (English, 繁體中文, 简体中文, 日本語, 한국어, Русский, Español), following the system language by default. Adding a locale is a single-file PR — see `src/locales/en.ts`.

## Performance

Parsing runs in a native Rust core on a background thread, so the window stays responsive while a file loads. The list is virtualized and pages load on demand, so the frontend never holds the whole log in memory. Scrolling and filtering stay smooth on logs in the hundreds of megabytes.

## Privacy

Fully offline by default. It reads local files and makes no network requests: no telemetry, nothing leaves the machine. The one exception is opt-in: a "check for updates" setting (off by default) that, when enabled, contacts GitHub at startup to look for a newer release — either notifying you with a download link, or, on installed builds, downloading and installing it.

## Install

Download an installer or the portable exe from the [Releases](../../releases) page, or build from source.

**⚠️ First run:** the release builds are not code-signed (signing needs a paid certificate), so the first time you run the installer or the app, Windows may show a **"Windows protected your PC"** SmartScreen dialog. Click **More info**, then **Run anyway**. This is expected for an unsigned open-source app.

Building from source needs [Rust](https://www.rust-lang.org/tools/install) (stable, MSVC toolchain on Windows), [Node.js](https://nodejs.org/) 20+, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/). WebView2 ships with Windows 10/11. `npm run tauri build` signs its auto-updater artifacts, so it needs an updater signing key: generate your own once (press Enter at password prompts to leave it empty) and point `TAURI_SIGNING_PRIVATE_KEY` at it before building.

```bash
npm install
npm run tauri dev      # run in development (no key needed)

npm run tauri signer generate -- -w path\to\updater.key   # one-time; keep the key outside the repo
set TAURI_SIGNING_PRIVATE_KEY=path\to\updater.key
npm run tauri build    # build UnityLogViewer.exe and installers
```

The executable lands in `src-tauri/target/release/` and the MSI/NSIS installers in `src-tauri/target/release/bundle/`. The executable is self-contained and runs from anywhere.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `F8` / `Shift+F8` | Next / previous error |
| `1` / `2` / `3` | Toggle Log / Warning / Error filters |
| `Ctrl+F` | Focus search |
| `B` | Toggle bookmark on the selected entry |
| `Esc` | Clear search |
| `↑` / `↓` | Move selection |
| `Home` / `End` | Jump to top / bottom |
| `Ctrl+scroll`, `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom text |
| `Ctrl+W` / `Ctrl+Tab` | Close / cycle tabs |

## Platform support

Windows 10/11 is the supported and tested platform. The parsing core is cross-platform, but the local-log scan, IDE integration, and file association are Windows-only for now. There are no macOS or Linux builds yet.

## Tech stack

[Tauri 2](https://tauri.app/), React and TypeScript (Vite), and a dependency-free Rust parsing core (`ulv-core`). The parsing logic is kept separate from Tauri and covered by unit tests (`cargo test`, `npm test`).

## Development

Built with help from [Claude](https://www.anthropic.com/claude); the author reviewed the design decisions and the changes.

## License

Copyright © 2026 bwaynesu. Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later).

You can use, modify, and distribute the software, but any distributed or network-served derivative must be released under the AGPL with its complete source code. It does not permit a closed-source fork or product.
