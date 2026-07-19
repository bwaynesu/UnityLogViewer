use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Level {
    Log,
    Warning,
    Error,
    Assert,
    Exception,
}

#[derive(Debug, Clone, Serialize)]
pub struct StackFrame {
    pub raw: String,
    /// Source path, only when the build wrote one (dev builds / `(at ...)` style).
    pub file: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub id: u32,
    /// 1-based line number of the entry's first line in the file.
    pub line_no: u32,
    /// Byte offset of the entry's first line in the parsed text. An entry
    /// always begins with a fresh parser state, so re-parsing from this offset
    /// reproduces exactly the entries a full parse yields from here on — the
    /// property live tail relies on to parse only the file's new tail.
    pub offset: usize,
    pub level: Level,
    pub message: String,
    pub frames: Vec<StackFrame>,
    /// Collapse key: first message line + first frame.
    pub hash: u64,
}

/// First line of Unity's native crash-dump section. The full marker is
/// `========== OUTPUTTING STACK TRACE ==================`.
pub const CRASH_MARKER: &str = "========== OUTPUTTING STACK TRACE";

/// Exception header: `NullReferenceException: ...`, `System.AggregateException: ...`
static EXCEPTION_HEADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[\w.]*Exception(: | \()").unwrap());

/// Caller-side stack frame written by Unity's log handler, e.g.
/// `UnityEngine.Debug:Log(Object)`, `<AwakeScene>d__19:MoveNext()`,
/// `Cysharp...UniTaskCompletionSourceCore`1:TrySetException(Exception)`.
/// No spaces before the parens; must end with `)`.
static CALLER_FRAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[\w.<>`+\[\],]+:[\w.<>`+\[\],]+ ?\(.*\)\s*$").unwrap());

/// `(at Assets/Scripts/Foo.cs:42)` — editor/dev style frame location.
static AT_LOCATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(at ([^)]+):(\d+)\)").unwrap());

/// `... [0x00018] in D:\path\file.cs:42` — managed exception frame location.
/// `in <guid>:0` carries no path and is rejected by the `<` check below.
static IN_LOCATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r" in (.+):(\d+)\s*$").unwrap());

/// A line that is only closing brackets/braces/parens, optionally with `,`/`;`
/// (e.g. `}`, `},`, `};`, `}]`, `})`) — the tail of a multi-line dump.
fn is_closing_bracket(line: &str) -> bool {
    let t = line.trim();
    t.chars().any(|c| matches!(c, '}' | ']' | ')'))
        && t.chars().all(|c| matches!(c, '}' | ']' | ')' | ',' | ';'))
}

fn frame_location(raw: &str) -> (Option<String>, Option<u32>) {
    let caps = AT_LOCATION
        .captures(raw)
        .or_else(|| IN_LOCATION.captures(raw));
    if let Some(c) = caps {
        let file = &c[1];
        if !file.starts_with('<') {
            return (Some(file.to_string()), c[2].parse().ok());
        }
    }
    (None, None)
}

struct Builder {
    line_no: u32,
    offset: usize,
    level: Level,
    message: String,
    frames: Vec<StackFrame>,
}

impl Builder {
    fn finish(self, id: u32) -> LogEntry {
        let mut level = self.level;
        if level == Level::Log {
            level = infer_level(&self.message, &self.frames);
        }
        // Digits are masked before hashing so entries differing only in varying values
        // (tick counters, timestamps, positions, counters embedded in the message)
        // collapse into one group. Over-groups "Level 1" vs "Level 2"; the
        // detail panel still shows individual occurrences, so acceptable.
        let mut h = DefaultHasher::new();
        for b in self.message.lines().next().unwrap_or("").bytes() {
            h.write_u8(if b.is_ascii_digit() { b'#' } else { b });
        }
        if let Some(f) = self.frames.first() {
            f.raw.hash(&mut h);
        }
        LogEntry {
            id,
            line_no: self.line_no,
            offset: self.offset,
            level,
            message: self.message,
            frames: self.frames,
            hash: h.finish(),
        }
    }
}

fn infer_level(message: &str, frames: &[StackFrame]) -> Level {
    for f in frames {
        // Caller frames like `UnityEngine.Debug:LogError(Object)` reveal the API used.
        if f.raw.contains(":LogError(") || f.raw.contains(":LogException(") {
            return Level::Error;
        }
        if f.raw.contains(":LogWarning") {
            return Level::Warning;
        }
        if f.raw.contains(":LogAssertion") {
            return Level::Assert;
        }
        if f.raw.contains("Internal_LogException") {
            return Level::Exception;
        }
    }
    if message.starts_with("Assertion failed") {
        return Level::Assert;
    }
    if message.starts_with(CRASH_MARKER) {
        return Level::Error; // native crash section start
    }
    // message-pattern level table (shader warnings etc.) is deferred: add it as a
    // data-driven (Regex, Level) list once real misclassified cases show up.
    Level::Log
}

/// Parse a whole log text into entries. Line-classifying state machine.
pub fn parse(text: &str) -> Vec<LogEntry> {
    parse_with_progress(text, |_| {})
}

/// Like [`parse`], invoking `progress(bytes_processed)` periodically (roughly every
/// 8k lines) so callers can report a percentage. Final call is not guaranteed to
/// equal `text.len()`; treat completion of this function as 100%.
pub fn parse_with_progress(text: &str, mut progress: impl FnMut(usize)) -> Vec<LogEntry> {
    let mut entries: Vec<LogEntry> = Vec::new();
    let mut current: Option<Builder> = None;
    let mut bytes_done: usize = 0;

    let flush = |b: Option<Builder>, entries: &mut Vec<LogEntry>| {
        if let Some(b) = b {
            let id = entries.len() as u32;
            entries.push(b.finish(id));
        }
    };

    for (i, raw_line) in text.split('\n').enumerate() {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        let line_no = (i + 1) as u32;
        bytes_done += raw_line.len() + 1;
        if i % 8192 == 0 {
            progress(bytes_done);
        }

        if line.trim().is_empty() {
            flush(current.take(), &mut entries);
            continue;
        }

        // Exception managed frame: `  at Foo.Bar () [0x...] in path:0`
        if line.starts_with("  at ") || line.starts_with("\tat ") {
            if let Some(b) = current.as_mut() {
                let (file, ln) = frame_location(line);
                b.frames.push(StackFrame {
                    raw: line.trim_start().to_string(),
                    file,
                    line: ln,
                });
                continue;
            }
            // orphan frame at file start: fall through, treat as message
        } else if line.starts_with(' ') || line.starts_with('\t') {
            // Indented continuation (e.g. fields under `Direct3D:`) joins the entry.
            if let Some(b) = current.as_mut() {
                b.message.push('\n');
                b.message.push_str(line);
                continue;
            }
        } else if CALLER_FRAME.is_match(line) {
            if let Some(b) = current.as_mut() {
                let (file, ln) = frame_location(line);
                b.frames.push(StackFrame {
                    raw: line.to_string(),
                    file,
                    line: ln,
                });
                continue;
            }
        } else if is_closing_bracket(line) {
            // Unindented `}` / `]` / `)` (with optional `,;`) closes a multi-line
            // object/JSON dump in the current message; keep it attached instead
            // of splitting it off as its own entry.
            if let Some(b) = current.as_mut() {
                b.message.push('\n');
                b.message.push_str(line);
                continue;
            }
        }

        // Anything else starts a new entry.
        flush(current.take(), &mut entries);
        current = Some(Builder {
            line_no,
            offset: bytes_done - raw_line.len() - 1,
            level: if EXCEPTION_HEADER.is_match(line) {
                Level::Exception
            } else {
                Level::Log
            },
            message: line.to_string(),
            frames: Vec::new(),
        });
    }
    flush(current.take(), &mut entries);
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_lines_are_separate_entries() {
        // Real logs have no blank lines between single-line entries.
        let e = parse("first message\nsecond message\nthird message\n");
        assert_eq!(e.len(), 3);
        assert_eq!(e[1].message, "second message");
        assert_eq!(e[1].line_no, 2);
        assert!(e.iter().all(|x| x.level == Level::Log));
    }

    #[test]
    fn caller_frames_attach_to_entry() {
        let text = "Camera Register Camera\n\
                    UnityEngine.Debug:Log(Object)\n\
                    CameraManager:Register(CameraController, Boolean)\n\
                    CameraController:Awake()\n\
                    \n\
                    next entry\n";
        let e = parse(text);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].frames.len(), 3);
        assert_eq!(e[1].message, "next entry");
    }

    #[test]
    fn reparse_from_last_entry_offset_equals_full_parse() {
        // The live-tail contract: re-parsing from the last entry's byte offset
        // must yield exactly what a full parse yields from that point, even
        // when the appended bytes extend that entry with more frames.
        let head = "warmup line\nCamera Register Camera\nUnityEngine.Debug:Log(Object)\n";
        let tail = "CameraManager:Register(CameraController, Boolean)\nnew entry after\n";
        let full = parse(&format!("{head}{tail}"));

        let partial = parse(head);
        let last = partial.last().unwrap();
        assert_eq!(&head[last.offset..last.offset + 6], "Camera");
        let resumed = parse(&format!("{}{tail}", &head[last.offset..]));

        // splice: entries before the last + resumed (rebased) == full parse
        assert_eq!(full.len(), partial.len() - 1 + resumed.len());
        for (f, r) in full.iter().skip(partial.len() - 1).zip(&resumed) {
            assert_eq!(f.message, r.message);
            assert_eq!(f.frames.len(), r.frames.len());
            assert_eq!(f.hash, r.hash);
            assert_eq!(f.offset, r.offset + last.offset);
            assert_eq!(f.line_no, r.line_no + last.line_no - 1);
        }
    }

    #[test]
    fn colon_space_message_is_not_a_frame() {
        // `SceneLoader: Load Scene R040` must be its own entry, not a frame.
        let e = parse("some entry\nSceneLoader: Load Scene R040\n");
        assert_eq!(e.len(), 2);
        assert!(e[0].frames.is_empty());
    }

    #[test]
    fn exception_block() {
        let text = "prev message\n\
                    NullReferenceException: Object reference not set to an instance of an object.\n\
                    \x20\x20at UnityEngine.Component.get_transform () [0x00006] in <0dd1e06>:0 \n\
                    \x20\x20at Game.Foo.Bar () [0x004c5] in D:\\Proj\\Assets\\Scripts\\Foo.cs:42 \n\
                    UnityEngine.Debug:LogException(Exception)\n";
        let e = parse(text);
        assert_eq!(e.len(), 2);
        let ex = &e[1];
        assert_eq!(ex.level, Level::Exception);
        assert_eq!(ex.frames.len(), 3);
        // release frame `<guid>` has no location
        assert_eq!(ex.frames[0].file, None);
        // dev frame has full path + line
        assert_eq!(ex.frames[1].file.as_deref(), Some("D:\\Proj\\Assets\\Scripts\\Foo.cs"));
        assert_eq!(ex.frames[1].line, Some(42));
    }

    #[test]
    fn at_style_location() {
        let text = "boom\nGameManager:Update() (at Assets/Scripts/GameManager.cs:42)\n";
        let e = parse(text);
        assert_eq!(e[0].frames[0].file.as_deref(), Some("Assets/Scripts/GameManager.cs"));
        assert_eq!(e[0].frames[0].line, Some(42));
    }

    #[test]
    fn level_from_caller_frames() {
        let err = parse("bad thing\nUnityEngine.Debug:LogError(Object)\n");
        assert_eq!(err[0].level, Level::Error);
        let warn = parse("meh\nUnityEngine.Debug:LogWarning(Object)\n");
        assert_eq!(warn[0].level, Level::Warning);
        let ex = parse("kaboom\nUnityEngine.DebugLogHandler:Internal_LogException_Injected(Exception, IntPtr)\n");
        assert_eq!(ex[0].level, Level::Exception);
    }

    #[test]
    fn lone_closing_brace_joins_message() {
        // Multi-line object dump: the col-0 `}` must stay with the entry.
        let e = parse("Dumping state: {\n  \"hp\": 5,\n}\nnext entry\n");
        assert_eq!(e.len(), 2);
        assert!(e[0].message.contains("\"hp\": 5"));
        assert!(e[0].message.ends_with('}'));
        assert_eq!(e[1].message, "next entry");
    }

    #[test]
    fn indented_continuation_joins_message() {
        let text = "Direct3D:\n    Version:  Direct3D 11.0 [level 11.1]\n    VRAM:     11997 MB\n";
        let e = parse(text);
        assert_eq!(e.len(), 1);
        assert!(e[0].message.contains("VRAM"));
    }

    #[test]
    fn identical_entries_share_hash() {
        let e = parse("same\nUnityEngine.Debug:Log(Object)\n\nsame\nUnityEngine.Debug:Log(Object)\n\ndifferent\n");
        assert_eq!(e[0].hash, e[1].hash);
        assert_ne!(e[0].hash, e[2].hash);
    }

    #[test]
    fn hash_masks_varying_numbers() {
        // Spam pattern: identical message, only an embedded counter/timestamp varies.
        let e = parse(
            "(100001) [Loader] loaded asset id:5\n\n\
             (100002) [Loader] loaded asset id:0\n\n\
             [00:00:01] [Timer] tick 42\n\n\
             [00:00:07] [Timer] tick 99\n",
        );
        assert_eq!(e[0].hash, e[1].hash);
        assert_eq!(e[2].hash, e[3].hash);
        assert_ne!(e[0].hash, e[2].hash);
    }

    #[test]
    fn crash_marker_is_error() {
        let e = parse("normal line\n========== OUTPUTTING STACK TRACE ==================\n\nSymInit: Symbol-SearchPath: '.;Z:\\'\n");
        assert_eq!(e[0].level, Level::Log);
        assert_eq!(e[1].level, Level::Error);
        assert!(e[1].message.starts_with(CRASH_MARKER));
    }

    #[test]
    fn tolerates_empty_and_truncated_input() {
        assert!(parse("").is_empty());
        assert!(parse("\n\n\n").is_empty());
        // truncated tail (no trailing newline, half an exception block)
        let e = parse("NullReferenceException: oops\n  at Foo.Bar () [0x0000");
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].level, Level::Exception);
    }

    #[test]
    fn crlf_input() {
        let e = parse("one\r\ntwo\r\n");
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].message, "one");
    }

    #[test]
    fn progress_is_reported_monotonically() {
        let text = "line\n".repeat(20_000);
        let mut calls: Vec<usize> = Vec::new();
        let entries = parse_with_progress(&text, |b| calls.push(b));
        assert_eq!(entries.len(), 20_000);
        assert!(calls.len() >= 2, "expected multiple progress calls");
        assert!(calls.windows(2).all(|w| w[0] < w[1]));
        assert!(*calls.last().unwrap() <= text.len() + 1);
    }
}
