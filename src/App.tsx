import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkUpdater } from "@tauri-apps/plugin-updater";
import {
  closeFile,
  getEntries,
  getGroups,
  getOccurrences,
  isPortable,
  nextError,
  openFile,
  openInIde,
  positionOf,
  resolvePath,
  scanLocalLogs,
  scanWatched,
  setTail,
  startupPaths,
  topErrors,
  type TailUpdate,
  validateRoot,
  type FilterParams,
  type LocalLog,
  type Row,
  type StackFrame,
  type Stats,
} from "./lib/api";
import { toggleBookmark, type Bookmark } from "./lib/bookmarks";
import { buildFilter, CHUNK, missingChunks, type LevelToggles } from "./lib/filter";
import { setLocale, t } from "./lib/i18n";
import { checkForUpdate } from "./lib/update";
import {
  clampScale,
  loadRecent,
  loadSettings,
  pushRecent,
  rgba,
  saveRecent,
  saveSettings,
  type Settings,
} from "./lib/settings";
import SettingsModal from "./SettingsModal";
import Sidebar from "./Sidebar";
import "./App.css";

const LEVEL_ICON: Record<Row["entry"]["level"], string> = {
  Log: "ⓘ",
  Warning: "⚠",
  Error: "⛔",
  Assert: "⛔",
  Exception: "⛔",
};

type Selection = { index: number; row: Row } | null;
/** stats === null → browser-style empty "New Tab" showing the home page. */
type Tab = { id: number; stats: Stats | null };

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [toggles, setToggles] = useState<LevelToggles>({ log: true, warning: true, error: true });
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [collapse, setCollapse] = useState(false);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Selection>(null);
  const [occurrences, setOccurrences] = useState<number[]>([]);
  const [top, setTop] = useState<Row[]>([]);
  // session-only bookmarks, keyed by file id (see lib/bookmarks.ts)
  const [bookmarks, setBookmarks] = useState<Record<number, Bookmark[]>>({});
  // live-tail toggle per file id; the poller thread lives on the Rust side
  const [tailing, setTailing] = useState<Record<number, boolean>>({});
  const [tailTick, setTailTick] = useState(0); // re-fetch trigger for sidebar data
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [localLogs, setLocalLogs] = useState<LocalLog[]>([]);
  const [watched, setWatched] = useState<LocalLog[]>([]);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  // manual project root, session-cached only (cleared when the window closes)
  const [manualRoot, setManualRoot] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    text: string;
    copyPath?: string;
    retryFrame?: StackFrame; // "Set project root…" retries this frame on success
    action?: { label: string; run: () => void }; // e.g. Download (open page) / Restart
  } | null>(null);
  const cacheRef = useRef<Map<number, Row[]>>(new Map());
  const [, bump] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingScrollRef = useRef<"bottom" | "top" | null>(null);
  const pendingJumpRef = useRef<number | null>(null); // entry id to select after view change
  const emptyIdRef = useRef(-1); // frontend-only ids for empty tabs (Rust ids are positive)

  const stats = tabs.find((t) => t.id === active)?.stats ?? null;

  // Before any child renders, so a language change re-renders the whole UI translated.
  setLocale(settings.language);

  useEffect(() => saveSettings(settings), [settings]);
  // Opt-in update check — runs at startup and whenever the mode changes (so
  // switching it on checks immediately instead of waiting for a relaunch).
  // "notify" = link to the download page; "auto" = download + install via the
  // Tauri updater, then offer to restart; auto falls back to notify on failure.
  useEffect(() => {
    if (settings.updates === "off") return;
    let cancelled = false;
    const notify = async () => {
      const u = await checkForUpdate(await getVersion());
      if (!cancelled && u)
        setNotice({
          text: t("updateAvailable", { version: u.version }),
          action: { label: t("download"), run: () => openUrl(u.url) },
        });
    };
    (async () => {
      if (settings.updates !== "auto") return notify();
      if (await isPortable()) return notify(); // portable can't self-install — just notify
      try {
        const update = await checkUpdater();
        if (!update) return;
        if (cancelled) return;
        setNotice({ text: t("downloadingUpdate", { version: update.version }) });
        await update.downloadAndInstall();
        // ponytail: on a portable exe this runs the installer (installs the app);
        // gate on install location if that turns out to matter.
        if (!cancelled)
          setNotice({
            text: t("updatedTo", { version: update.version }),
            action: { label: t("restartNow"), run: () => relaunch() },
          });
      } catch {
        await notify(); // updater unavailable/blocked — fall back to the manual link
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.updates]);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const filter: FilterParams = useMemo(
    () => buildFilter(toggles, debouncedQuery, useRegex, caseSensitive),
    [toggles, debouncedQuery, useRegex, caseSensitive],
  );
  const fetchPage = useCallback(
    (f: FilterParams, offset: number, limit: number) =>
      (collapse ? getGroups : getEntries)(active!, f, offset, limit),
    [collapse, active],
  );

  const load = useCallback(
    async (path: string) => {
      const fromId = active;
      const fromEmpty = tabs.find((t) => t.id === fromId && t.stats === null) !== undefined;
      const existing = tabs.find((t) => t.stats?.path === path);
      if (existing) {
        // consumed the empty tab's action — drop it, browser-style
        if (fromEmpty) setTabs((ts) => ts.filter((t) => t.id !== fromId));
        setActive(existing.id);
        setSelected(null);
        return;
      }
      setLoading(true);
      setProgress(0);
      setError(null);
      try {
        const o = await openFile(path);
        cacheRef.current = new Map();
        setTabs((ts) => {
          const idx = fromEmpty ? ts.findIndex((t) => t.id === fromId) : -1;
          const tab = { id: o.fileId, stats: o.stats };
          // opening from an empty tab replaces it in place
          return idx >= 0 ? ts.map((t, i) => (i === idx ? tab : t)) : [...ts, tab];
        });
        setActive(o.fileId);
        setSelected(null);
        setTotal(o.stats.total);
        pendingScrollRef.current = settings.openAt;
        setRecent((r) => {
          const next = pushRecent(r, path);
          saveRecent(next);
          return next;
        });
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [settings.openAt, tabs, active],
  );

  /** Browser-style new tab: empty tab showing the home page. */
  const newTab = () => {
    const id = emptyIdRef.current--;
    setTabs((ts) => [...ts, { id, stats: null }]);
    setSelected(null);
    setActive(id);
  };

  const switchTab = (id: number) => {
    if (id === active) return;
    cacheRef.current = new Map();
    setSelected(null);
    setActive(id);
  };

  const closeTab = (id: number) => {
    if (id > 0) closeFile(id); // empty tabs have no Rust-side file (also stops its tail poller)
    setBookmarks(({ [id]: _, ...rest }) => rest);
    setTailing(({ [id]: _t, ...rest }) => rest);
    setTabs((ts) => {
      const idx = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (id === active) {
        const neighbor = next[idx] ?? next[idx - 1];
        cacheRef.current = new Map();
        setSelected(null);
        setActive(neighbor ? neighbor.id : null);
      }
      return next;
    });
  };

  // CLI open: file args at launch + args forwarded by a second instance.
  // loadRef keeps the mount-only effect on the latest `load` closure.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    // first path only; multi-file CLI when someone asks
    startupPaths().then((ps) => {
      if (ps[0]) loadRef.current(ps[0]);
    });
    const un = listen<string[]>("cli-open", (e) => {
      if (e.payload[0]) loadRef.current(e.payload[0]);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // drag & drop + parse progress events
  useEffect(() => {
    const unDrop = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && e.payload.paths[0]) load(e.payload.paths[0]);
    });
    const unProg = listen<number>("parse-progress", (e) => setProgress(e.payload));
    return () => {
      unDrop.then((f) => f());
      unProg.then((f) => f());
    };
  }, [load]);

  const toggleTail = () => {
    if (active === null || active < 0) return;
    const on = !tailing[active];
    setTailing((m) => ({ ...m, [active]: on }));
    setTail(active, on).catch(() => setTailing((m) => ({ ...m, [active]: false })));
  };

  // home page (no tabs, or an empty tab): scan LocalLow + user's watched folders
  const showingHome = stats === null;
  useEffect(() => {
    if (!showingHome) return;
    scanLocalLogs().then(setLocalLogs);
    if (settings.scanFolders.length > 0) {
      scanWatched(settings.scanFolders, settings.scanDepth).then(setWatched);
    } else {
      setWatched([]);
    }
  }, [showingHome, settings.scanFolders, settings.scanDepth]);

  // per-file summary for the sidebar (positive ids only; empty tabs are frontend-local)
  useEffect(() => {
    if (active !== null && active > 0) topErrors(active, 10).then(setTop);
  }, [active, tailTick]);

  // view change (filter / collapse / tab) → reset cache, refetch, keep selection anchored
  useEffect(() => {
    if (!stats || active === null) return;
    cacheRef.current = new Map();
    let stale = false;
    fetchPage(filter, 0, CHUNK)
      .then((p) => {
        if (stale) return;
        setFilterError(null);
        cacheRef.current.set(0, p.items);
        setTotal(p.total);
        bump((n) => n + 1);

        const jumpId = pendingJumpRef.current ?? selected?.row.entry.id ?? null;
        pendingJumpRef.current = null;
        if (jumpId !== null) {
          positionOf(active, filter, jumpId, collapse).then((pos) => {
            if (stale) return;
            virtualizer.scrollToIndex(Math.min(pos.index, Math.max(0, p.total - 1)), {
              align: "center",
            });
            if (pos.matches) {
              fetchPage(filter, pos.index, 1).then((one) => {
                if (!stale && one.items[0]) select(pos.index, one.items[0]);
              });
            } else {
              setSelected(null);
            }
          });
        }
      })
      .catch((e) => {
        if (!stale) setFilterError(String(e));
      });
    return () => {
      stale = true;
    };
    // deps: `active`, not `stats` — tail updates replace the stats object every
    // tick, and this effect's positionOf anchoring would yank the scroll then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, collapse, active, stats !== null]);

  const rowH = Math.round(24 * settings.fontScale);
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => listRef.current,
    estimateSize: () => rowH,
    overscan: 20,
  });
  useEffect(() => virtualizer.measure(), [rowH, virtualizer]);

  // initial scroll position after a file opens
  useEffect(() => {
    const want = pendingScrollRef.current;
    if (want && total > 0) {
      pendingScrollRef.current = null;
      virtualizer.scrollToIndex(want === "bottom" ? total - 1 : 0, { align: "auto" });
    }
  }, [total, virtualizer]);

  // fetch chunks covering the visible window
  const vItems = virtualizer.getVirtualItems();
  const vStart = vItems[0]?.index ?? 0;
  const vEnd = vItems[vItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (!stats || active === null) return;
    const cache = cacheRef.current;
    for (const chunk of missingChunks(vStart, vEnd, (c) => cache.has(c))) {
      cache.set(chunk, []);
      fetchPage(filter, chunk * CHUNK, CHUNK)
        .then((p) => {
          cache.set(chunk, p.items);
          bump((n) => n + 1);
        })
        .catch(() => cache.delete(chunk));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vStart, vEnd, stats, filter, collapse]);

  // live tail: the Rust poller emits tail-update after splicing new entries in.
  // Ids are stable on append (only the last entry may be re-parsed in place),
  // so selection and bookmarks stay valid — just drop the page cache, refresh
  // totals, and keep following the bottom if the user was already there.
  useEffect(() => {
    const un = listen<TailUpdate>("tail-update", (ev) => {
      const { fileId, stats: s, reset } = ev.payload;
      setTabs((ts) => ts.map((tb) => (tb.id === fileId ? { ...tb, stats: s } : tb)));
      if (reset) setBookmarks((bs) => ({ ...bs, [fileId]: [] })); // ids point at new content
      if (fileId !== active) return;
      if (reset) setSelected(null);
      const follow = reset || vEnd >= total - 2; // near bottom → keep following
      cacheRef.current = new Map();
      fetchPage(filter, 0, 1).then((p) => {
        setTotal(p.total);
        bump((n) => n + 1);
        if (follow && p.total > 0) virtualizer.scrollToIndex(p.total - 1, { align: "end" });
      });
      setTailTick((n) => n + 1);
    });
    return () => {
      un.then((f) => f());
    };
  }, [active, filter, fetchPage, virtualizer, vEnd, total]);

  const rowAt = (i: number): Row | undefined =>
    cacheRef.current.get(Math.floor(i / CHUNK))?.[i % CHUNK];

  const select = useCallback(
    (index: number, row: Row) => {
      setSelected({ index, row });
      if (collapse && active !== null) {
        setOccurrences([]);
        getOccurrences(active, filter, row.entry.id).then(setOccurrences);
      }
    },
    [collapse, filter, active],
  );

  const marks = active !== null ? bookmarks[active] ?? [] : [];
  const markIds = useMemo(() => new Set(marks.map((b) => b.id)), [marks]);

  const toggleMark = useCallback(() => {
    if (!selected || active === null) return;
    const e = selected.row.entry;
    const mark: Bookmark = { id: e.id, level: e.level, text: e.message.split("\n")[0] };
    setBookmarks((bs) => ({ ...bs, [active]: toggleBookmark(bs[active] ?? [], mark) }));
  }, [selected, active]);

  const jumpToError = useCallback(
    (backwards: boolean) => {
      if (active === null) return;
      const from = selected?.index ?? vStart - 1;
      nextError(active, filter, collapse, from, backwards).then((idx) => {
        if (idx === null) return;
        virtualizer.scrollToIndex(idx, { align: "center" });
        fetchPage(filter, idx, 1).then((p) => {
          if (p.items[0]) select(idx, p.items[0]);
        });
      });
    },
    [selected, vStart, filter, collapse, virtualizer, fetchPage, select, active],
  );

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (e.key === "F8") {
        e.preventDefault();
        jumpToError(e.shiftKey);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        if (active !== null) {
          e.preventDefault();
          closeTab(active);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
        if (tabs.length > 1 && active !== null) {
          e.preventDefault();
          const idx = tabs.findIndex((t) => t.id === active);
          switchTab(tabs[(idx + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length].id);
        }
        return;
      }
      if (typing) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") {
          setSettings((s) => ({ ...s, fontScale: clampScale(s.fontScale + 0.1) }));
        } else if (e.key === "-") {
          setSettings((s) => ({ ...s, fontScale: clampScale(s.fontScale - 0.1) }));
        } else if (e.key === "0") {
          setSettings((s) => ({ ...s, fontScale: 1 }));
        } else {
          return;
        }
        e.preventDefault();
        return;
      }
      if (e.key.toLowerCase() === "b") toggleMark();
      else if (e.key === "1") setToggles((t) => ({ ...t, log: !t.log }));
      else if (e.key === "2") setToggles((t) => ({ ...t, warning: !t.warning }));
      else if (e.key === "3") setToggles((t) => ({ ...t, error: !t.error }));
      else if (e.key === "Home") virtualizer.scrollToIndex(0);
      else if (e.key === "End") virtualizer.scrollToIndex(Math.max(0, total - 1));
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (total === 0) return;
        e.preventDefault();
        const cur = selected?.index ?? vStart - 1;
        const next = Math.min(total - 1, Math.max(0, cur + (e.key === "ArrowDown" ? 1 : -1)));
        const row = rowAt(next);
        if (row) select(next, row);
        virtualizer.scrollToIndex(next, { align: "auto" });
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setSettings((s) => ({ ...s, fontScale: clampScale(s.fontScale + (e.deltaY < 0 ? 0.1 : -0.1)) }));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  });

  // detail panel height drag
  const startDetailDrag = (down: React.MouseEvent) => {
    down.preventDefault();
    const bottom = (down.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().bottom;
    const onMove = (e: MouseEvent) => {
      const pct = Math.min(70, Math.max(15, ((bottom - e.clientY) / window.innerHeight) * 100));
      setSettings((s) => ({ ...s, detailPct: Math.round(pct) }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const pickFile = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: t("logFilesFilter"), extensions: ["log", "txt"] }],
    });
    if (typeof path === "string") load(path);
  };

  /** Click a stack frame → open in IDE, degrading gracefully when unmappable. */
  const openFrame = async (f: StackFrame, root: string | null = manualRoot) => {
    if (!f.file || f.line === null || active === null) return false;
    const local = await resolvePath(active, f.file, root);
    if (local) {
      openInIde(active, settings.ideTemplate, local, f.line, root).catch((e) =>
        setNotice({ text: t("ideLaunchFailed", { error: String(e) }) }),
      );
      return true;
    }
    setNotice({ text: t("noLocalFile", { file: f.file }), copyPath: f.file, retryFrame: f });
    return false;
  };

  /** Notice-bar "Set project root…": pick, validate, then retry the failed frame. */
  const pickRootAndRetry = async (retry: StackFrame) => {
    const dir = await openDialog({ directory: true });
    if (typeof dir !== "string") return;
    if (!(await validateRoot(dir))) {
      setNotice({ text: t("notUnityRoot"), retryFrame: retry });
      return;
    }
    const root = dir.replace(/\\/g, "/");
    setManualRoot(root);
    setNotice(null);
    if (!(await openFrame(retry, root))) {
      setNotice({
        text: t("rootStillNotFound", { file: retry.file ?? "" }),
        copyPath: retry.file ?? undefined,
      });
    }
  };

  // auto-dismiss passive notices; actionable ones (retry / update action) stay until handled
  useEffect(() => {
    if (!notice || notice.retryFrame || notice.action) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /** Jump from a collapse-group occurrence to that entry in the flat view. */
  const jumpToOccurrence = (id: number) => {
    pendingJumpRef.current = id;
    setCollapse(false);
  };

  /** Jump to an entry in the current view (sidebar top-error click). */
  const jumpToEntry = (id: number) => {
    if (active === null) return;
    positionOf(active, filter, id, collapse).then((pos) => {
      virtualizer.scrollToIndex(Math.min(pos.index, Math.max(0, total - 1)), { align: "center" });
      if (pos.matches) {
        fetchPage(filter, pos.index, 1).then((p) => {
          if (p.items[0]) select(pos.index, p.items[0]);
        });
      }
    });
  };

  const tintFor = (level: Row["entry"]["level"]): string | undefined => {
    if (!settings.rowTint) return undefined;
    if (level === "Warning") return rgba(settings.warningTint, settings.warningAlpha);
    if (level !== "Log") return rgba(settings.errorTint, settings.errorAlpha);
    return undefined;
  };

  const toggleBtn = (key: keyof LevelToggles, icon: string, count: number) => (
    <button
      className={`lvl-btn ${key} ${toggles[key] ? "on" : ""}`}
      onClick={() => setToggles((t) => ({ ...t, [key]: !t[key] }))}
      title={`${t(key === "log" ? "lvlLog" : key === "warning" ? "lvlWarning" : "lvlError")} (${key === "log" ? "1" : key === "warning" ? "2" : "3"})`}
    >
      {icon} {count.toLocaleString()}
    </button>
  );

  const overlay = loading && (
    <div className="overlay">
      <div className="overlay-box">{t("parsing", { pct: progress })}</div>
    </div>
  );

  const tabbar = tabs.length > 0 && (
    <div className="tabbar">
      {tabs.map((tb) => (
        <div
          key={tb.id}
          className={`tab ${tb.id === active ? "on" : ""}`}
          title={tb.stats?.path}
          onClick={() => switchTab(tb.id)}
        >
          <span className="tab-name">{tb.stats ? fileName(tb.stats.path) : t("newTab")}</span>
          <span
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tb.id);
            }}
          >
            ×
          </span>
        </div>
      ))}
      <button className="mini" title={t("newTab")} onClick={newTab}>
        +
      </button>
    </div>
  );

  const fontVars = {
    "--ui-fs": `${Math.round(13 * settings.fontScale)}px`,
    "--list-fs": `${Math.round(12 * settings.fontScale)}px`,
    "--row-h": `${rowH}px`,
  } as React.CSSProperties;

  // Shared across the home and viewer layouts so update/error notices show in both.
  const noticeBar = notice && (
    <div className="notice">
      <span className="msg">{notice.text}</span>
      {notice.retryFrame && (
        <button className="mini" onClick={() => pickRootAndRetry(notice.retryFrame!)}>
          {t("setProjectRoot")}
        </button>
      )}
      {notice.copyPath && (
        <button className="mini" onClick={() => navigator.clipboard.writeText(notice.copyPath!)}>
          {t("copyPath")}
        </button>
      )}
      {notice.action && (
        <button className="mini" onClick={() => notice.action!.run()}>
          {notice.action.label}
        </button>
      )}
      <button className="mini" onClick={() => setNotice(null)}>
        ✕
      </button>
    </div>
  );

  if (!stats) {
    return (
      <main className="viewer" style={fontVars}>
        {overlay}
        {tabbar}
        <div className="home">
          {/* margin:auto centering (not justify-content) so tall content scrolls from the top */}
          <div className="home-inner">
          <h1>
            Unity Log Viewer{" "}
            <a
              className="author-link"
              onClick={() => openUrl("https://bwaynesu.github.io/portfolio/")}
              title="bwaynesu's portfolio"
            >
              by bwaynesu
            </a>
          </h1>
          <p className="drop-hint" onClick={pickFile}>
            {t("dropHint")}
          </p>
          {error && <p className="error-text">{error}</p>}
          <div className="empty-cols">
            {recent.length > 0 && (
              <div className="empty-col">
                <h3>{t("recent")}</h3>
                {recent.map((p) => (
                  <button key={p} className="empty-item" title={p} onClick={() => load(p)}>
                    {fileName(p)}
                    <span className="hint">{p}</span>
                  </button>
                ))}
              </div>
            )}
            {localLogs.length > 0 && (
              <div className="empty-col">
                <h3>{t("localLogs")}</h3>
                {localLogs.slice(0, 12).map((l) => (
                  <button key={l.path} className="empty-item" title={l.path} onClick={() => load(l.path)}>
                    {fileName(l.path)}
                    <span className="hint">
                      {l.game} · {fmtSize(l.size)} · {new Date(l.modifiedMs).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {watched.length > 0 && (
              <div className="empty-col">
                <h3>{t("watchedFolders")}</h3>
                {watched.slice(0, 12).map((l) => (
                  <button key={l.path} className="empty-item" title={l.path} onClick={() => load(l.path)}>
                    {fileName(l.path)}
                    <span className="hint">
                      {l.game} · {fmtSize(l.size)} · {new Date(l.modifiedMs).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>
        <button className="home-settings" title={t("settings")} onClick={() => setShowSettings(true)}>
          ⚙
        </button>
        {noticeBar}
        {showSettings && (
          <SettingsModal
            settings={settings}
            onChange={setSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </main>
    );
  }

  const idxWidth = `${Math.max(3, String(stats.total).length)}ch`;
  const sel = selected?.row;

  return (
    <main className="viewer" style={fontVars}>
      {overlay}
      {tabbar}
      <div className="toolbar">
        <input
          ref={searchRef}
          className={`search ${filterError ? "bad" : ""}`}
          placeholder={t("searchPlaceholder")}
          title={filterError ?? t("searchTitle")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <button
          className={`mini ${caseSensitive ? "on" : ""}`}
          title={t("matchCase")}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </button>
        <button
          className={`mini ${useRegex ? "on" : ""}`}
          title={t("regex")}
          onClick={() => setUseRegex((v) => !v)}
        >
          .*
        </button>
        <button
          className={`mini ${collapse ? "on" : ""}`}
          title={t("collapseTitle")}
          onClick={() => setCollapse((v) => !v)}
        >
          {t("collapse")}
        </button>
        <button
          className={`mini ${active !== null && tailing[active] ? "on" : ""}`}
          title={t("liveTailTitle")}
          onClick={toggleTail}
        >
          ⏵ {t("liveTail")}
        </button>
        {toggleBtn("log", "ⓘ", stats.log)}
        {toggleBtn("warning", "⚠", stats.warning)}
        {toggleBtn("error", "⛔", stats.error + stats.assert + stats.exception)}
        <button
          className={`mini ${settings.showSidebar ? "on" : ""}`}
          title={t("sidebarToggle")}
          onClick={() => setSettings((s) => ({ ...s, showSidebar: !s.showSidebar }))}
        >
          ☰
        </button>
        <button onClick={() => setShowSettings(true)} title={t("settings")}>
          ⚙
        </button>
      </div>

      <div className="body-row">
        <div className="list" ref={listRef}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {vItems.map((vi) => {
              const row = rowAt(vi.index);
              const e = row?.entry;
              const isSel = selected !== null && selected.index === vi.index;
              return (
                <div
                  key={vi.key}
                  className={`row ${isSel ? "selected" : ""}`}
                  style={{
                    transform: `translateY(${vi.start}px)`,
                    background: e && !isSel ? tintFor(e.level) : undefined,
                  }}
                  onClick={() => row && select(vi.index, row)}
                >
                  {e ? (
                    <>
                      {settings.showIndex && (
                        <span className="idx" style={{ width: idxWidth }}>
                          {e.id + 1}
                        </span>
                      )}
                      <span className={`icon ${e.level}`}>{LEVEL_ICON[e.level]}</span>
                      {markIds.has(e.id) && <span className="bm">★</span>}
                      <span className="msg">{e.message.split("\n")[0]}</span>
                      {row.count !== null && row.count > 1 && (
                        <span className="badge">×{row.count.toLocaleString()}</span>
                      )}
                    </>
                  ) : (
                    <span className="msg placeholder">…</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {settings.showSidebar && (
          <Sidebar
            stats={stats}
            top={top}
            bookmarks={marks}
            onJump={jumpToEntry}
            onRemoveBookmark={(id) =>
              active !== null &&
              setBookmarks((bs) => ({ ...bs, [active]: (bs[active] ?? []).filter((b) => b.id !== id) }))
            }
            width={settings.sidebarW}
            onWidth={(w) => setSettings((s) => ({ ...s, sidebarW: w }))}
          />
        )}
      </div>

      {sel && (
        <div className="detail" style={{ height: `${settings.detailPct}%` }}>
          <div className="detail-drag" onMouseDown={startDetailDrag} />
          <div className="detail-head">
            <span className={`icon ${sel.entry.level}`}>
              {LEVEL_ICON[sel.entry.level]} {sel.entry.level} · #{sel.entry.id + 1} ·{" "}
              {t("lineNo", { n: sel.entry.line_no })}
              {sel.count !== null && sel.count > 1 && ` · ×${sel.count.toLocaleString()}`}
            </span>
            <span className="spacer" />
            <button
              className={markIds.has(sel.entry.id) ? "bm" : ""}
              title={t("bookmarkToggle")}
              onClick={toggleMark}
            >
              {markIds.has(sel.entry.id) ? "★" : "☆"}
            </button>
            <button
              title={t("copyRefTitle")}
              onClick={() =>
                navigator.clipboard.writeText(
                  `${fileName(stats.path)} #${sel.entry.id + 1} [${sel.entry.level}] ${sel.entry.message.split("\n")[0]}`,
                )
              }
            >
              {t("copyRef")}
            </button>
            <button
              onClick={() =>
                navigator.clipboard.writeText(
                  [sel.entry.message, ...sel.entry.frames.map((f) => f.raw)].join("\n"),
                )
              }
            >
              {t("copy")}
            </button>
            <button onClick={() => setSelected(null)}>✕</button>
          </div>
          {collapse && occurrences.length > 1 && (
            <div className="occurrences">
              {t("occurrences")}
              {occurrences.slice(0, 50).map((id) => (
                <button key={id} className="mini" onClick={() => jumpToOccurrence(id)}>
                  #{id + 1}
                </button>
              ))}
              {occurrences.length > 50 && (
                <span className="hint">{t("occurrencesTotal", { count: occurrences.length })}</span>
              )}
            </div>
          )}
          <pre className="detail-msg">{sel.entry.message}</pre>
          {sel.entry.frames.length > 0 && (
            <div className="frames">
              {sel.entry.frames.map((f, i) => (
                <div
                  key={i}
                  className={`frame ${f.file && f.line !== null ? "linked" : ""}`}
                  title={f.file && f.line !== null ? t("openInIde") : undefined}
                  onClick={() => openFrame(f)}
                >
                  {f.raw}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {noticeBar}

      <div className="statusbar">
        {t(collapse ? "statusGroups" : "statusEntries", {
          shown: total.toLocaleString(),
          total: stats.total.toLocaleString(),
        })}
        {stats.banner.engine_version && <span> · Unity {stats.banner.engine_version}</span>}
        {stats.banner.renderer && <span> · {stats.banner.renderer}</span>}
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </main>
  );
}
