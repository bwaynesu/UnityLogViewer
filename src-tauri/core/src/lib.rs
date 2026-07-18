//! Unity log parsing core. No Tauri dependencies allowed here.
//!
//! Format facts (verified against real Unity Player.log samples):
//! - Player.log has no timestamps and no level prefixes by default.
//! - Blank lines are NOT reliable entry separators: with stack traces disabled,
//!   consecutive single-line entries have no blank line between them.
//! - Therefore parsing is a line-classifying state machine, not blank-line splitting.

mod banner;
mod parser;

pub use banner::{parse_banner, Banner};
pub use parser::{parse, parse_with_progress, Level, LogEntry, StackFrame, CRASH_MARKER};
