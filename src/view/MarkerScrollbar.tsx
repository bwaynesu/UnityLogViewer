import type { MouseEvent, RefObject } from "react";
import { t } from "../lib/i18n";
import "./MarkerScrollbar.css";

export type MarkKind = "warning" | "error" | "bookmark";
export type MarkKinds = Record<MarkKind, boolean>;

interface Props {
  trackRef: RefObject<HTMLDivElement | null>;
  /** Canvas the marker map is painted onto; the map itself lives in App. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  thumb: { top: number; height: number } | null;
  onMouseDown: (e: MouseEvent) => void;
  menu: { x: number; y: number } | null;
  onMenu: (at: { x: number; y: number } | null) => void;
  kinds: MarkKinds;
  onToggleKind: (kind: MarkKind) => void;
}

/**
 * The list's scrollbar, drawn by hand (the native one cannot be used — see
 * lib/scroll.ts), whose track doubles as the marker map for the whole file.
 * Right-clicking it picks which kinds the map paints.
 */
export default function MarkerScrollbar(p: Props) {
  const items: [MarkKind, string][] = [
    ["warning", t("lvlWarning")],
    ["error", t("lvlError")],
    ["bookmark", t("bookmarks")],
  ];
  return (
    <>
      <div
        className="vscroll"
        ref={p.trackRef}
        onMouseDown={p.onMouseDown}
        onContextMenu={(e) => {
          e.preventDefault();
          p.onMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <canvas className="vmarks" ref={p.canvasRef} />
        {p.thumb && <div className="vthumb" style={{ top: p.thumb.top, height: p.thumb.height }} />}
      </div>
      {p.menu && (
        <div
          className="vmenu"
          style={{ left: p.menu.x, top: p.menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {items.map(([kind, label]) => (
            <button key={kind} className="vmenu-item" onClick={() => p.onToggleKind(kind)}>
              <span className="vmenu-check">{p.kinds[kind] ? "✓" : ""}</span>
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
