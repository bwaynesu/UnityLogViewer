import type { Row } from "../lib/api";

/** Unity Console's visual language: same glyph for every error-ish level. */
export const LEVEL_ICON: Record<Row["entry"]["level"], string> = {
  Log: "ⓘ",
  Warning: "⚠",
  Error: "⛔",
  Assert: "⛔",
  Exception: "⛔",
};

export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
