# Unity Log Viewer

*Also in [繁體中文（台灣）](README.zh-TW.md).*

A desktop viewer for Unity `Player.log` files. It parses the log into structured entries so you can read and search large logs that bog down a text editor.

Player.log has no timestamps and no level prefixes, so in a text editor it reads as a flat wall of lines. This tool rebuilds each entry with its stack trace, works out the severity, groups repeated messages, and lets you click a stack frame to open that file and line in your IDE.

> Status: v1.0.0, feature-complete for its scope.  
> Runs on Windows 10/11.

## Why

Real player logs run to hundreds of megabytes and hundreds of thousands of lines, which is enough to make a general text editor sluggish. The format also carries structure that an editor ignores: call-site stack frames, exception blocks, and the startup banner. Recovering that structure is most of what this tool does. And when you find an error, the source line is one click away.

## Features

Reading
- Parses the timestamp-less, prefix-less Player.log with a line-classifying parser. Splitting on blank lines does not work, because consecutive single-line entries have none between them.
- Infers the level (Log, Warning, Error, Assert, Exception) from the call-site frames Unity writes.
- Collapses duplicate messages into groups with an ×N count. Numbers in the message (ticks, timestamps, coordinates) are masked, so spam that differs only in its numbers folds into one group.
- Detail panel with the full message, a formatted stack trace, and a copy button for the raw entry.

Finding
- Search across the message and the stack frames. Space-separated terms are AND-matched, `-term` excludes, and there are case and regex toggles.
- Error navigation with F8 / Shift+F8, level filters on 1 / 2 / 3, and a selection that stays put when you change filters.
- Native crash-dump detection: a file with an `OUTPUTTING STACK TRACE` section is flagged with a link to jump to it.

IDE deep-linking
- Click a `file:line` stack frame to open it in your IDE at that line, with no setup. It follows what Unity does: read Unity's configured external script editor, then fall back through Visual Studio (located with `vswhere`), Rider, VS Code, and Sublime. A custom command template is available as an override.

Triage panel
- A system-info card from the log banner (Unity version, graphics API, GPU, VRAM, driver), with a button to copy a summary for bug reports.
- Level counts for the whole file and a Top 10 list of repeated errors, each clickable to jump to the entry.

Workflow
- Tabs, recent files, and one-click open of Player.log files found under LocalLow, plus folders you add yourself.
- Command-line open (`UnityLogViewer <path>`) with single-instance handling, and an optional .log file association.
- Light, gray, and dark themes, adjustable font size (Ctrl+scroll), row tinting, and other preferences, stored locally.

## Performance

Parsing runs in a Rust core on a background thread, so the window stays responsive while a file loads. The list is virtualized and pages load on demand, so the frontend never holds the whole log in memory. Scrolling and filtering stay smooth on logs in the hundreds of megabytes.

## Privacy

The app is offline. It reads local files and makes no network requests: no telemetry, no update checks, nothing leaves the machine. A "check for updates" option is planned for later and will default to off.

## Install

Download an installer from the [Releases](../../releases) page, or build from source. Building needs [Rust](https://www.rust-lang.org/tools/install) (stable, MSVC toolchain on Windows), [Node.js](https://nodejs.org/) 20+, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/). WebView2 ships with Windows 10/11.

```bash
npm install
npm run tauri dev      # run in development
npm run tauri build    # build UnityLogViewer.exe and installers
```

The executable lands in `src-tauri/target/release/`, and the MSI/NSIS installers in `src-tauri/target/release/bundle/`. The executable is self-contained and runs from anywhere.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `F8` / `Shift+F8` | Next / previous error |
| `1` / `2` / `3` | Toggle Log / Warning / Error filters |
| `Ctrl+F` | Focus search |
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

Built with help from [Claude](https://www.anthropic.com/claude) (Claude Code); the author reviewed the design decisions and the changes.

## Roadmap

- CI for automated builds
- Bookmarks
- Optional update check (off by default)

## License

Copyright © 2026 bwaynesu. Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later).

This is a strong-copyleft license: you can use, modify, and distribute the software, but any distributed or network-served derivative must be released under the AGPL with its complete source code. It does not permit a closed-source fork or product.
