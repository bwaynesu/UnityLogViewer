import type { MouseEvent, ReactNode } from "react";
import type { Row, StackFrame } from "../lib/api";
import { t } from "../lib/i18n";
import { LEVEL_ICON } from "./common";
import "./DetailPanel.css";

interface Props {
  row: Row;
  /** Panel height as a % of the window (drag-resized, persisted in Settings). */
  heightPct: number;
  bookmarked: boolean;
  /** Occurrence list of the selected collapse group; empty in the flat view. */
  occurrences: number[];
  /** Text reference put on the clipboard by "Copy ref". */
  fileLabel: string;
  onDragStart: (e: MouseEvent) => void;
  onToggleBookmark: () => void;
  onJumpOccurrence: (id: number) => void;
  onOpenFrame: (f: StackFrame) => void;
  onClose: () => void;
  hl: (text: string) => ReactNode;
}

export default function DetailPanel(p: Props) {
  const e = p.row.entry;
  const firstLine = e.message.split("\n")[0];
  return (
    <div className="detail" style={{ height: `${p.heightPct}%` }}>
      <div className="detail-drag" onMouseDown={p.onDragStart} />
      <div className="detail-head">
        <span className={`icon ${e.level}`}>
          {LEVEL_ICON[e.level]} {e.level} · #{e.id + 1} · {t("lineNo", { n: e.line_no })}
          {p.row.count !== null && p.row.count > 1 && ` · ×${p.row.count.toLocaleString()}`}
        </span>
        <span className="spacer" />
        <button
          className={p.bookmarked ? "bm" : ""}
          title={t("bookmarkToggle")}
          onClick={p.onToggleBookmark}
        >
          {p.bookmarked ? "★" : "☆"}
        </button>
        <button
          title={t("copyRefTitle")}
          onClick={() =>
            navigator.clipboard.writeText(
              `${p.fileLabel} #${e.id + 1} [${e.level}] ${firstLine}`,
            )
          }
        >
          {t("copyRef")}
        </button>
        <button
          onClick={() =>
            navigator.clipboard.writeText([e.message, ...e.frames.map((f) => f.raw)].join("\n"))
          }
        >
          {t("copy")}
        </button>
        <button onClick={p.onClose}>✕</button>
      </div>
      {p.occurrences.length > 1 && (
        <div className="occurrences">
          {t("occurrences")}
          {p.occurrences.slice(0, 50).map((id) => (
            <button key={id} className="mini" onClick={() => p.onJumpOccurrence(id)}>
              #{id + 1}
            </button>
          ))}
          {p.occurrences.length > 50 && (
            <span className="hint">{t("occurrencesTotal", { count: p.occurrences.length })}</span>
          )}
        </div>
      )}
      <pre className="detail-msg">{p.hl(e.message)}</pre>
      {e.frames.length > 0 && (
        <div className="frames">
          {e.frames.map((f, i) => (
            <div
              key={i}
              className={`frame ${f.file && f.line !== null ? "linked" : ""}`}
              title={f.file && f.line !== null ? t("openInIde") : undefined}
              onClick={() => p.onOpenFrame(f)}
            >
              {p.hl(f.raw)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
