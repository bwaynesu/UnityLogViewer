import { en, type Messages } from "../locales/en";
import { zhTW } from "../locales/zh-TW";
import { zhCN } from "../locales/zh-CN";
import { ja } from "../locales/ja";
import { ko } from "../locales/ko";
import { ru } from "../locales/ru";
import { es } from "../locales/es";

export const LOCALES = {
  en,
  "zh-TW": zhTW,
  "zh-CN": zhCN,
  ja,
  ko,
  ru,
  es,
} satisfies Record<string, Messages>;

export type Locale = keyof typeof LOCALES;

/** Native names for the settings dropdown — never translated. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-TW": "繁體中文",
  "zh-CN": "简体中文",
  ja: "日本語",
  ko: "한국어",
  ru: "Русский",
  es: "Español",
};

/** Map the system language list onto a supported locale (en fallback). */
export function detectLocale(langs?: readonly string[]): Locale {
  const list =
    langs ?? (typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : []);
  for (const l of list) {
    const lower = l.toLowerCase();
    if (lower.startsWith("zh")) return /tw|hk|mo|hant/.test(lower) ? "zh-TW" : "zh-CN";
    const two = lower.slice(0, 2);
    if (two in LOCALES) return two as Locale;
  }
  return "en";
}

// Module-level current locale: App calls setLocale() at the top of its render,
// before any child calls t(), so a settings change re-renders everything in the
// new language without threading a context through every component.
let current: Messages = en;

export function setLocale(lang: "auto" | Locale) {
  current = LOCALES[lang === "auto" ? detectLocale() : lang];
}

/**
 * Look up a message; `{x}` placeholders are replaced from params.
 * Placeholders without a matching param stay literal (the IDE hint shows
 * raw {path}/{line} on purpose).
 */
export function t(key: keyof Messages, params?: Record<string, string | number>): string {
  let s = current[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
