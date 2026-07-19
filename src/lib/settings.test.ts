import { expect, test } from "vitest";
import { clampScale, DEFAULTS, mergeSettings, pushRecent, rgba } from "./settings";

test("pushRecent dedups, front-inserts, caps at 10", () => {
  expect(pushRecent(["a", "b"], "b")).toEqual(["b", "a"]);
  const eleven = pushRecent(Array.from({ length: 10 }, (_, i) => `f${i}`), "new");
  expect(eleven).toHaveLength(10);
  expect(eleven[0]).toBe("new");
});

test("mergeSettings returns defaults for garbage", () => {
  expect(mergeSettings(null)).toEqual(DEFAULTS);
  expect(mergeSettings("junk")).toEqual(DEFAULTS);
  expect(mergeSettings({ fontScale: "big", openAt: "sideways" })).toEqual(DEFAULTS);
});

test("mergeSettings keeps custom ide template; blank means auto", () => {
  expect(mergeSettings({ ideTemplate: 'rider64 --line {line} "{path}"' }).ideTemplate).toContain("rider64");
  expect(mergeSettings({}).ideTemplate).toBe("");
  expect(mergeSettings({ ideTemplate: 42 }).ideTemplate).toBe("");
});

test("legacy stored default template migrates to auto", () => {
  expect(mergeSettings({ ideTemplate: 'code -g "{path}:{line}"' }).ideTemplate).toBe("");
});

test("scanFolders keeps strings only; scanDepth clamps 0-5", () => {
  expect(mergeSettings({ scanFolders: ["D:/Logs", 42, null] }).scanFolders).toEqual(["D:/Logs"]);
  expect(mergeSettings({ scanDepth: 99 }).scanDepth).toBe(5);
  expect(mergeSettings({ scanDepth: -1 }).scanDepth).toBe(0);
});

test("checkForUpdates defaults off and accepts a stored boolean", () => {
  expect(mergeSettings({}).checkForUpdates).toBe(false);
  expect(mergeSettings({ checkForUpdates: true }).checkForUpdates).toBe(true);
  expect(mergeSettings({ checkForUpdates: "yes" }).checkForUpdates).toBe(false);
});

test("mergeSettings keeps valid stored values and clamps out-of-range", () => {
  const s = mergeSettings({ fontScale: 99, showIndex: false, openAt: "top", detailPct: 5, showSidebar: false });
  expect(s.fontScale).toBe(2);
  expect(s.showIndex).toBe(false);
  expect(s.openAt).toBe("top");
  expect(s.detailPct).toBe(15);
  expect(s.showSidebar).toBe(false);
  expect(mergeSettings({ sidebarW: 5 }).sidebarW).toBe(80);
  expect(mergeSettings({ sidebarW: 99999 }).sidebarW).toBe(4000);
});

test("theme accepts the three modes, rejects anything else", () => {
  expect(mergeSettings({ theme: "light" }).theme).toBe("light");
  expect(mergeSettings({ theme: "gray" }).theme).toBe("gray");
  expect(mergeSettings({ theme: "dark" }).theme).toBe("dark");
  expect(mergeSettings({ theme: "neon" }).theme).toBe(DEFAULTS.theme);
  expect(mergeSettings({}).theme).toBe("gray");
});

test("clampScale bounds and rounds", () => {
  expect(clampScale(0.1)).toBe(0.7);
  expect(clampScale(3)).toBe(2);
  expect(clampScale(1.2499)).toBe(1.2);
});

test("rgba converts hex, rejects junk", () => {
  expect(rgba("#f48771", 0.1)).toBe("rgba(244, 135, 113, 0.1)");
  expect(rgba("red", 0.1)).toBe("transparent");
});
