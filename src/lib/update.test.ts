import { expect, test } from "vitest";
import { isNewer } from "./update";

test("isNewer compares numeric version components", () => {
  expect(isNewer("1.2.0", "1.1.0")).toBe(true);
  expect(isNewer("1.1.1", "1.1.0")).toBe(true);
  expect(isNewer("2.0.0", "1.9.9")).toBe(true);
  expect(isNewer("1.1.0", "1.1.0")).toBe(false); // same
  expect(isNewer("1.0.9", "1.1.0")).toBe(false); // older
});

test("isNewer tolerates a leading v and short versions", () => {
  expect(isNewer("v1.2.0", "1.1.0")).toBe(true);
  expect(isNewer("1.2", "1.1.9")).toBe(true);
  expect(isNewer("1.1", "1.1.0")).toBe(false); // 1.1 == 1.1.0
});
