/** Persisted user settings. Stored in localStorage — survives restarts. */
export interface Settings {
  theme: "light" | "gray" | "dark";
  fontScale: number; // 0.7–2.0, 1 = 100%
  showIndex: boolean;
  rowTint: boolean;
  warningTint: string; // hex
  warningAlpha: number;
  errorTint: string;
  errorAlpha: number;
  openAt: "bottom" | "top";
  detailPct: number; // detail panel height, % of window
  showSidebar: boolean; // system info + error summary panel (toolbar-toggled, like detailPct)
  sidebarW: number; // sidebar width px, drag-resized
  /** Advanced IDE override; blank = zero-config auto (VS solution → system default). */
  ideTemplate: string;
  /** Extra folders scanned for *.log on the home page (besides LocalLow). */
  scanFolders: string[];
  /** Subfolder levels to descend when scanning (0 = top level only). */
  scanDepth: number;
  /**
   * Update behaviour, checked once at startup. "off" = no network at all.
   * "notify" = check GitHub and show a link to download yourself.
   * "auto" = download + install via the Tauri updater (installer builds).
   */
  updates: "off" | "notify" | "auto";
}

export const DEFAULTS: Settings = {
  theme: "gray",
  fontScale: 1,
  showIndex: true,
  rowTint: true,
  warningTint: "#ffdd94",
  warningAlpha: 0.4,
  errorTint: "#f48771",
  errorAlpha: 0.4,
  openAt: "bottom",
  detailPct: 30,
  showSidebar: true,
  sidebarW: 260,
  ideTemplate: "",
  scanFolders: [],
  scanDepth: 2,
  updates: "off",
};

export const clampScale = (n: number) => Math.min(2, Math.max(0.7, Math.round(n * 10) / 10));

/** Merge a stored (possibly stale/partial/garbage) object over the defaults. */
export function mergeSettings(raw: unknown): Settings {
  const s = { ...DEFAULTS };
  if (typeof raw !== "object" || raw === null) return s;
  const r = raw as Record<string, unknown>;
  if (r.theme === "light" || r.theme === "gray" || r.theme === "dark") s.theme = r.theme;
  if (typeof r.fontScale === "number") s.fontScale = clampScale(r.fontScale);
  if (typeof r.showIndex === "boolean") s.showIndex = r.showIndex;
  if (typeof r.rowTint === "boolean") s.rowTint = r.rowTint;
  if (typeof r.warningTint === "string") s.warningTint = r.warningTint;
  if (typeof r.warningAlpha === "number") s.warningAlpha = Math.min(0.5, Math.max(0, r.warningAlpha));
  if (typeof r.errorTint === "string") s.errorTint = r.errorTint;
  if (typeof r.errorAlpha === "number") s.errorAlpha = Math.min(0.5, Math.max(0, r.errorAlpha));
  if (r.openAt === "top" || r.openAt === "bottom") s.openAt = r.openAt;
  if (typeof r.detailPct === "number") s.detailPct = Math.min(70, Math.max(15, r.detailPct));
  if (typeof r.showSidebar === "boolean") s.showSidebar = r.showSidebar;
  if (typeof r.sidebarW === "number") s.sidebarW = Math.min(4000, Math.max(80, r.sidebarW));
  if (typeof r.ideTemplate === "string") {
    // migration: an old build stored this as the DEFAULT template; it must mean
    // "auto", not a deliberate VS Code choice (it hijacked the zero-config ladder)
    s.ideTemplate = r.ideTemplate === 'code -g "{path}:{line}"' ? "" : r.ideTemplate;
  }
  if (Array.isArray(r.scanFolders)) {
    s.scanFolders = r.scanFolders.filter((p): p is string => typeof p === "string").slice(0, 20);
  }
  if (typeof r.scanDepth === "number") s.scanDepth = Math.min(5, Math.max(0, Math.round(r.scanDepth)));
  if (r.updates === "off" || r.updates === "notify" || r.updates === "auto") s.updates = r.updates;
  else if (typeof r.checkForUpdates === "boolean") s.updates = r.checkForUpdates ? "notify" : "off"; // migrate v1.1.0
  return s;
}

const KEY = "ulv-settings";

export function loadSettings(): Settings {
  try {
    return mergeSettings(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Recent files: most recent first, deduped, capped at 10. */
export function pushRecent(list: string[], path: string): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, 10);
}

export function loadRecent(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem("ulv-recent") ?? "[]");
    return Array.isArray(r) ? r.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: string[]) {
  localStorage.setItem("ulv-recent", JSON.stringify(list));
}

/** `#rrggbb` + alpha → `rgba()` string for row tinting. */
export function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "transparent";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
