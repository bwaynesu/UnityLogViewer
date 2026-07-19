/**
 * Source-of-truth locale. Every other locale file must provide exactly these
 * keys — enforced at compile time by the `Messages` type. `{x}` placeholders
 * are filled by t()'s params; placeholders without a matching param are left
 * as-is (the IDE template hint relies on that).
 *
 * Adding a language: copy this file, translate the values, register it in
 * `src/lib/i18n.ts` (LOCALES + LOCALE_NAMES). PRs welcome.
 */
export const en = {
  // shared
  copy: "Copy",
  settings: "Settings",
  // tab bar
  newTab: "New Tab",
  // parse overlay
  parsing: "Parsing… {pct}%",
  // toolbar
  searchPlaceholder: "Search…  -term excludes",
  searchTitle: "Ctrl+F · plain terms AND-match, -term excludes",
  matchCase: "Match case",
  regex: "Regular expression",
  collapse: "Collapse",
  collapseTitle: "Collapse identical entries",
  sidebarToggle: "System info & error summary",
  lvlLog: "log",
  lvlWarning: "warning",
  lvlError: "error",
  // home page
  dropHint: "Drop a Player.log here, or click to open a file",
  recent: "Recent",
  localLogs: "Local Player.log",
  watchedFolders: "Watched folders",
  logFilesFilter: "Log files",
  // notices
  updateAvailable: "Update available: v{version}",
  download: "Download",
  downloadingUpdate: "Downloading update v{version}…",
  updatedTo: "Updated to v{version}",
  restartNow: "Restart now",
  ideLaunchFailed: "IDE launch failed: {error}",
  noLocalFile: 'No local file for "{file}"',
  setProjectRoot: "Set project root…",
  copyPath: "Copy path",
  notUnityRoot: "Not a Unity project root (needs Assets/ + ProjectSettings/ProjectVersion.txt)",
  rootStillNotFound: 'Root set, but "{file}" still not found under it',
  // detail panel
  lineNo: "line {n}",
  occurrences: "Occurrences:",
  occurrencesTotal: "…{count} total",
  openInIde: "Open in IDE",
  // status bar
  statusEntries: "{shown} entries / {total} total",
  statusGroups: "{shown} groups / {total} total",
  // sidebar
  crashNotice: "💥 Native crash in this file — jump to stack trace",
  crashTitle: "Jump to the native crash stack trace section",
  systemInfo: "System info",
  copySummaryTitle: "Copy summary for bug reports",
  graphics: "Graphics",
  driver: "Driver",
  errorSummary: "Error summary",
  noErrors: "No errors 🎉",
  // bookmarks
  bookmarks: "Bookmarks",
  bookmarkToggle: "Bookmark (B)",
  copyRef: "Copy ref",
  copyRefTitle: "Copy a text reference (file name + entry number)",
  // settings modal
  resetAll: "Reset all",
  appearance: "Appearance",
  language: "Language",
  langAuto: "Auto (system)",
  theme: "Theme",
  themeLight: "Light",
  themeGray: "Gray",
  themeDark: "Dark",
  fontSize: "Font size",
  ctrlWheelHint: "Ctrl+wheel to zoom",
  showIndexCol: "Show entry index column",
  tintRows: "Tint warning / error rows",
  warningTint: "Warning tint",
  errorTint: "Error tint",
  behavior: "Behavior",
  openAt: "After opening a file, scroll to",
  openAtBottom: "Bottom (newest)",
  openAtTop: "Top",
  homeScan: "Home page scan",
  scanDepth: "Scan depth (subfolder levels)",
  addFolder: "Add folder…",
  besidesLocalLow: "Besides LocalLow",
  system: "System",
  assocLabel: "Open .log files with Unity Log Viewer (double-click)",
  windowsOnly: "Windows only",
  updates: "Updates",
  updatesOff: "Off",
  updatesNotify: "Notify me (download myself)",
  updatesAuto: "Download & install automatically",
  autoNeedsInstaller: "Auto needs the installer build",
  ide: "IDE",
  customCommand: "Custom command",
  idePlaceholder: "blank = auto (Visual Studio solution → system default)",
  ideTitle: 'Advanced override. {path} and {line} are substituted, e.g. code -g "{path}:{line}"',
  about: "About",
  license: "License",
  noWarranty: "This program comes with absolutely no warranty.",
  sourceCode: "Source code",
};

export type Messages = { [K in keyof typeof en]: string };
