import type { ReactNode, RefObject } from "react";
import type { Row } from "../lib/api";
import { LEVEL_ICON } from "./common";
import "./LogList.css";

interface Props {
  listRef: RefObject<HTMLDivElement | null>;
  /** Half-open range of view rows to render, from lib/scroll's rangeOf. */
  start: number;
  end: number;
  /** Fractional scroll position in rows — rows are placed relative to it. */
  scrollRow: number;
  rowH: number;
  rowAt: (index: number) => Row | undefined;
  selectedIndex: number | null;
  onSelect: (index: number, row: Row) => void;
  showIndex: boolean;
  idxWidth: string;
  isBookmarked: (id: number) => boolean;
  tintFor: (level: Row["entry"]["level"]) => string | undefined;
  hl: (text: string) => ReactNode;
}

/**
 * The log list. There is deliberately no full-height spacer element: rows are
 * positioned relative to `scrollRow`, because a `total * rowH` spacer hits the
 * engine's maximum element height and silently strands everything past ~1.15M
 * rows. See lib/scroll.ts.
 */
export default function LogList(p: Props) {
  return (
    <div className="list" ref={p.listRef}>
      {Array.from({ length: Math.max(0, p.end - p.start) }, (_, k) => {
        const index = p.start + k;
        const row = p.rowAt(index);
        const e = row?.entry;
        const isSel = p.selectedIndex === index;
        return (
          <div
            key={index}
            className={`row ${isSel ? "selected" : ""}`}
            style={{
              transform: `translateY(${(index - p.scrollRow) * p.rowH}px)`,
              background: e && !isSel ? p.tintFor(e.level) : undefined,
            }}
            onClick={() => row && p.onSelect(index, row)}
          >
            {e ? (
              <>
                {p.showIndex && (
                  <span className="idx" style={{ width: p.idxWidth }}>
                    {e.id + 1}
                  </span>
                )}
                <span className={`icon ${e.level}`}>{LEVEL_ICON[e.level]}</span>
                {p.isBookmarked(e.id) && <span className="bm">★</span>}
                <span className="msg">{p.hl(e.message.split("\n")[0])}</span>
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
  );
}
