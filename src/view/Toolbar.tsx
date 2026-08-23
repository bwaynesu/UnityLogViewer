import type { RefObject } from "react";
import type { Stats } from "../lib/api";
import type { LevelToggles } from "../lib/filter";
import { t } from "../lib/i18n";
import "./Toolbar.css";

interface Props {
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (q: string) => void;
  /** Compile error from either side of the search (Rust filter or highlight regex). */
  searchError: string | null;
  caseSensitive: boolean;
  useRegex: boolean;
  /** ▽ off = the query only highlights, the list keeps every entry. */
  filterHits: boolean;
  collapse: boolean;
  tailing: boolean;
  sidebar: boolean;
  stats: Stats;
  toggles: LevelToggles;
  onToggle: (key: keyof LevelToggles) => void;
  onCaseSensitive: () => void;
  onUseRegex: () => void;
  onFilterHits: () => void;
  onCollapse: () => void;
  onTail: () => void;
  onSidebar: () => void;
  onSettings: () => void;
}

export default function Toolbar(p: Props) {
  const levelBtn = (key: keyof LevelToggles, icon: string, count: number) => (
    <button
      className={`lvl-btn ${key} ${p.toggles[key] ? "on" : ""}`}
      onClick={() => p.onToggle(key)}
      title={`${t(key === "log" ? "lvlLog" : key === "warning" ? "lvlWarning" : "lvlError")} (${key === "log" ? "1" : key === "warning" ? "2" : "3"})`}
    >
      {icon} {count.toLocaleString()}
    </button>
  );

  const mini = (on: boolean, title: string, label: string, onClick: () => void) => (
    <button className={`mini ${on ? "on" : ""}`} title={title} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div className="toolbar">
      <input
        ref={p.searchRef}
        type="search" /* ponytail: native clear (X) button; hand-rolled button only if it must be styled */
        className={`search ${p.searchError ? "bad" : ""}`}
        placeholder={t("searchPlaceholder")}
        title={p.searchError ?? t("searchTitle")}
        value={p.query}
        onChange={(e) => p.onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            p.onQuery("");
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {mini(p.caseSensitive, t("matchCase"), "Aa", p.onCaseSensitive)}
      {mini(p.useRegex, t("regex"), ".*", p.onUseRegex)}
      {mini(p.filterHits, t("filterHitsTitle"), "▽", p.onFilterHits)}
      {mini(p.collapse, t("collapseTitle"), t("collapse"), p.onCollapse)}
      {mini(p.tailing, t("liveTailTitle"), `⏵${t("liveTail")}`, p.onTail)}
      {levelBtn("log", "ⓘ", p.stats.log)}
      {levelBtn("warning", "⚠", p.stats.warning)}
      {levelBtn("error", "⛔", p.stats.error + p.stats.assert + p.stats.exception)}
      {mini(p.sidebar, t("sidebarToggle"), "☰", p.onSidebar)}
      <button onClick={p.onSettings} title={t("settings")}>
        ⚙
      </button>
    </div>
  );
}
