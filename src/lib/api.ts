import { invoke } from "@tauri-apps/api/core";

export type Level = "Log" | "Warning" | "Error" | "Assert" | "Exception";

export interface StackFrame {
  raw: string;
  file: string | null;
  line: number | null;
}

export interface LogEntry {
  id: number;
  line_no: number;
  level: Level;
  message: string;
  frames: StackFrame[];
  /** u64 truncated by JSON→f64 — never send back to Rust; use `id`-keyed APIs instead. */
  hash: number;
}

export interface Banner {
  engine_version: string | null;
  graphics_api: string | null;
  renderer: string | null;
  vram_mb: number | null;
  driver: string | null;
}

export interface Stats {
  path: string;
  total: number;
  log: number;
  warning: number;
  error: number;
  assert: number;
  exception: number;
  banner: Banner;
  projectRoot: string | null;
  /** Entry id of the native crash-dump marker, when the file contains one. */
  crashId: number | null;
}

export interface FilterParams {
  levels: Level[];
  includes: string[];
  excludes: string[];
  regex: boolean;
  caseSensitive: boolean;
}

export interface Row {
  entry: LogEntry;
  count: number | null;
}

export interface RowPage {
  total: number;
  offset: number;
  items: Row[];
}

export interface FilterPosition {
  index: number;
  matches: boolean;
}

export interface Opened {
  fileId: number;
  stats: Stats;
}

export interface LocalLog {
  game: string;
  path: string;
  size: number;
  modifiedMs: number;
}

export const openFile = (path: string) => invoke<Opened>("open_file", { path });

export const closeFile = (fileId: number) => invoke<void>("close_file", { fileId });

/** Player.log files detected under LocalLow, newest first. */
export const scanLocalLogs = () => invoke<LocalLog[]>("scan_local_logs");

/** *.log files in the user's watched folders, newest first. */
export const scanWatched = (folders: string[], depth: number) =>
  invoke<LocalLog[]>("scan_watched", { folders, depth });

export const getEntries = (fileId: number, filter: FilterParams, offset: number, limit: number) =>
  invoke<RowPage>("get_entries", { fileId, filter, offset, limit });

export const getGroups = (fileId: number, filter: FilterParams, offset: number, limit: number) =>
  invoke<RowPage>("get_groups", { fileId, filter, offset, limit });

export const getOccurrences = (fileId: number, filter: FilterParams, id: number) =>
  invoke<number[]>("get_occurrences", { fileId, filter, id });

export const positionOf = (fileId: number, filter: FilterParams, id: number, collapse: boolean) =>
  invoke<FilterPosition>("position_of", { fileId, filter, id, collapse });

export const nextError = (
  fileId: number,
  filter: FilterParams,
  collapse: boolean,
  from: number,
  backwards: boolean,
) => invoke<number | null>("next_error", { fileId, filter, collapse, from, backwards });

/** File paths from this process's command line, fetched once on mount. */
export const startupPaths = () => invoke<string[]>("startup_paths");

/** Is .log associated with this app? Registry is the source of truth. */
export const logAssociation = () => invoke<boolean>("log_association");

/** Returns "" on clean success, or a note to show the user (e.g. Windows still
 *  forcing a different default). Rejects on real failure. */
export const setLogAssociation = (enable: boolean) =>
  invoke<string>("set_log_association", { enable });

/** Top repeated errors over the whole file, for the summary panel. */
export const topErrors = (fileId: number, limit: number) =>
  invoke<Row[]>("top_errors", { fileId, limit });

export const validateRoot = (path: string) => invoke<boolean>("validate_root", { path });

export const resolvePath = (fileId: number, file: string, fallbackRoot: string | null) =>
  invoke<string | null>("resolve_path", { fileId, file, fallbackRoot });

/** Returns the strategy used, e.g. "custom" | "unity-editor-pref:Devenv" | "devenv" | "sln" | "default". */
export const openInIde = (
  fileId: number,
  template: string,
  path: string,
  line: number,
  fallbackRoot: string | null,
) => invoke<string>("open_in_ide", { fileId, template, path, line, fallbackRoot });
