import type { FilterParams, Level } from "./api";

/** Toolbar toggle state. Error toggle covers Error+Assert+Exception (Unity Console style). */
export interface LevelToggles {
  log: boolean;
  warning: boolean;
  error: boolean;
}

/** Convert toggle state to the explicit `levels` IPC param. Empty array = show nothing. */
export function levelsParam(t: LevelToggles): Level[] {
  const levels: Level[] = [];
  if (t.log) levels.push("Log");
  if (t.warning) levels.push("Warning");
  if (t.error) levels.push("Error", "Assert", "Exception");
  return levels;
}

/**
 * Split a search box value into include / exclude terms.
 * Plain mode: whitespace-separated AND terms; `-term` excludes.
 * Regex mode: the whole input is a single regex; no exclusion syntax.
 */
export function parseQuery(input: string, regex: boolean): { includes: string[]; excludes: string[] } {
  const trimmed = input.trim();
  if (trimmed === "") return { includes: [], excludes: [] };
  if (regex) return { includes: [trimmed], excludes: [] };
  const includes: string[] = [];
  const excludes: string[] = [];
  for (const tok of trimmed.split(/\s+/)) {
    if (tok.startsWith("-") && tok.length > 1) excludes.push(tok.slice(1));
    else if (tok !== "-") includes.push(tok);
  }
  return { includes, excludes };
}

export function buildFilter(
  toggles: LevelToggles,
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): FilterParams {
  return { levels: levelsParam(toggles), ...parseQuery(query, regex), regex, caseSensitive };
}

export const CHUNK = 200;

/** Chunk indexes needed to cover visible rows [start, end] that aren't cached yet. */
export function missingChunks(
  start: number,
  end: number,
  cached: (chunk: number) => boolean,
): number[] {
  const first = Math.floor(Math.max(0, start) / CHUNK);
  const last = Math.floor(Math.max(0, end) / CHUNK);
  const out: number[] = [];
  for (let c = first; c <= last; c++) if (!cached(c)) out.push(c);
  return out;
}
