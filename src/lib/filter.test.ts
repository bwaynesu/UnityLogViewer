import { expect, test } from "vitest";
import { CHUNK, levelsParam, missingChunks, parseQuery } from "./filter";

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
