import { afterEach, expect, test } from "vitest";
import { detectLocale, setLocale, t } from "./i18n";

afterEach(() => setLocale("en"));

test("t interpolates params and leaves unmatched placeholders literal", () => {
  expect(t("updateAvailable", { version: "1.2.3" })).toBe("Update available: v1.2.3");
  // the IDE hint must keep raw {path}/{line} when no params are given
  expect(t("ideTitle")).toContain("{path}");
});

test("setLocale switches every t() call", () => {
  setLocale("zh-TW");
  expect(t("settings")).toBe("設定");
  setLocale("ja");
  expect(t("copy")).toBe("コピー");
});

test("detectLocale maps zh variants and falls back to en", () => {
  expect(detectLocale(["zh-TW"])).toBe("zh-TW");
  expect(detectLocale(["zh-Hant-HK"])).toBe("zh-TW");
  expect(detectLocale(["zh-CN"])).toBe("zh-CN");
  expect(detectLocale(["zh"])).toBe("zh-CN");
  expect(detectLocale(["ja-JP"])).toBe("ja");
  expect(detectLocale(["fr-FR", "es-MX"])).toBe("es");
  expect(detectLocale(["fr-FR"])).toBe("en");
  expect(detectLocale([])).toBe("en");
});
