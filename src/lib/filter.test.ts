import { expect, test } from "vitest";
import {
  CHUNK,
  highlightPatterns,
  levelsParam,
  missingChunks,
  parseQuery,
  splitMatches,
} from "./filter";

/** Mirrors how App renders: empty split = paint nothing, show the raw text. */
const paint = (text: string, query: string, regex = false, caseSensitive = false) => {
  const segs = splitMatches(text, highlightPatterns(query, regex, caseSensitive) ?? []);
  return segs.length === 0 ? text : segs.map((s) => (s.hit ? `[${s.text}]` : s.text)).join("");
};

test("highlight marks every hit, merges overlaps, ignores excludes", () => {
  expect(paint("null ref, null again", "null -Curl")).toBe("[null] ref, [null] again");
  expect(paint("abcd", "abc bcd")).toBe("[abcd]"); // overlapping terms merge
  expect(paint("Null null", "null", false, true)).toBe("Null [null]");
  expect(paint("a(b)", "a(b)")).toBe("[a(b)]"); // plain mode escapes metacharacters
  expect(paint("aXa", "a*", true)).toBe("[a]X[a]"); // empty matches don't hang
});

test("highlight is empty when there is nothing to paint or the regex is invalid", () => {
  expect(splitMatches("anything", [])).toEqual([]);
  expect(paint("no hit here", "missing")).toBe("no hit here");
  expect(highlightPatterns("(", true, false)).toBeNull();
  expect(highlightPatterns("", false, false)).toEqual([]);
});

test("parseQuery splits includes and -excludes", () => {
  expect(parseQuery("null -Curl  ref", false)).toEqual({
    includes: ["null", "ref"],
    excludes: ["Curl"],
  });
});

test("parseQuery regex mode keeps whole input, ignores exclusion syntax", () => {
  expect(parseQuery("Exception|-Error", true)).toEqual({
    includes: ["Exception|-Error"],
    excludes: [],
  });
});

test("parseQuery handles empty and lone dash", () => {
  expect(parseQuery("   ", false)).toEqual({ includes: [], excludes: [] });
  expect(parseQuery("-", false)).toEqual({ includes: [], excludes: [] });
});

test("all toggles on sends the full explicit list", () => {
  expect(levelsParam({ log: true, warning: true, error: true })).toEqual([
    "Log",
    "Warning",
    "Error",
    "Assert",
    "Exception",
  ]);
});

test("all toggles off means show nothing", () => {
  expect(levelsParam({ log: false, warning: false, error: false })).toEqual([]);
});

test("error toggle expands to Error+Assert+Exception", () => {
  expect(levelsParam({ log: false, warning: false, error: true })).toEqual([
    "Error",
    "Assert",
    "Exception",
  ]);
});

test("log and warning only", () => {
  expect(levelsParam({ log: true, warning: true, error: false })).toEqual(["Log", "Warning"]);
});

test("missingChunks covers visible range", () => {
  expect(missingChunks(0, CHUNK * 2, () => false)).toEqual([0, 1, 2]);
});

test("missingChunks skips cached chunks", () => {
  expect(missingChunks(0, CHUNK * 2, (c) => c === 1)).toEqual([0, 2]);
});

test("missingChunks clamps negative start", () => {
  expect(missingChunks(-5, 10, () => false)).toEqual([0]);
});
