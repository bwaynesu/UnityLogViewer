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

/**
 * Compile the include terms into JS regexes for painting hits in the UI.
 * null = the input is not a valid regex (caller flags the search box).
 * ponytail: JS RegExp only approximates the Rust `regex` crate (lookaround,
 * unicode classes). Rust stays the authority on what matches; this only paints.
 */
export function highlightPatterns(
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): RegExp[] | null {
  const { includes } = parseQuery(query, regex);
  const flags = caseSensitive ? "g" : "gi";
  try {
    return includes.map((t) => new RegExp(regex ? t : escapeRe(t), flags));
  } catch {
    return null;
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text split into matched / unmatched runs. Empty = nothing to highlight. */
export function splitMatches(text: string, patterns: RegExp[]): { text: string; hit: boolean }[] {
  const ranges: [number, number][] = [];
  for (const p of patterns) {
    p.lastIndex = 0;
    for (let m = p.exec(text); m; m = p.exec(text)) {
      if (m[0] === "") p.lastIndex++; // empty match (e.g. `a*`) would loop forever
      else ranges.push([m.index, m.index + m[0].length]);
    }
  }
  if (ranges.length === 0) return [];
  ranges.sort((a, b) => a[0] - b[0]);
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (e <= at) continue; // already covered by an earlier match
    const prev = out[out.length - 1];
    if (s <= at && prev?.hit) prev.text += text.slice(at, e); // overlaps/abuts — one run
    else {
      if (s > at) out.push({ text: text.slice(at, s), hit: false });
      out.push({ text: text.slice(Math.max(s, at), e), hit: true });
    }
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
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
