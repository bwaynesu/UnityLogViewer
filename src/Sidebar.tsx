import { useState } from "react";
import type { Row, Stats } from "./lib/api";

interface Props {
  stats: Stats;
  top: Row[];
  onJump: (id: number) => void;
  width: number;
  onWidth: (w: number) => void;
}

const LEVEL_ICON: Record<Row["entry"]["level"], string> = {
  Log: "ⓘ",
  Warning: "⚠",
  Error: "⛔",
  Assert: "⛔",
  Exception: "⛔",
};

/** System info card + whole-file error summary. */
export default function Sidebar({ stats, top, onJump, width, onWidth }: Props) {
  const b = stats.banner;
  const [showSys, setShowSys] = useState(true);
  const [showErr, setShowErr] = useState(true);

  const startDrag = (down: React.MouseEvent) => {
    down.preventDefault();
    // near-full-window range; both bounds only exist to keep the drag handle recoverable
    const onMove = (e: MouseEvent) =>
      onWidth(Math.min(window.innerWidth - 120, Math.max(80, window.innerWidth - e.clientX)));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const sysRows: [string, string | null][] = [
    ["Unity", b.engine_version],
    ["Graphics", b.graphics_api],
    ["GPU", b.renderer],
    ["VRAM", b.vram_mb !== null ? `${b.vram_mb.toLocaleString()} MB` : null],
    ["Driver", b.driver],
  ];

  const copyAll = () => {
    const lines = [
      ...sysRows.filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`),
      `Entries: ${stats.total.toLocaleString()} (log ${stats.log}, warning ${stats.warning}, error ${stats.error}, assert ${stats.assert}, exception ${stats.exception})`,
      ...(stats.crashId !== null ? ["Native crash: yes (OUTPUTTING STACK TRACE section present)"] : []),
      ...(top.length > 0
        ? ["Top errors:", ...top.map((r) => `  ×${r.count} ${r.entry.message.split("\n")[0]}`)]
        : []),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="side-drag" onMouseDown={startDrag} />

      {stats.crashId !== null && (
        <button
          className="crash-notice"
          onClick={() => onJump(stats.crashId!)}
          title="Jump to the native crash stack trace section"
        >
          💥 Native crash in this file — jump to stack trace
        </button>
      )}

      <section className="side-sec">
        <div className="side-head clickable" onClick={() => setShowSys((v) => !v)}>
          {showSys ? "▾" : "▸"} System info
          <span className="spacer" />
          <button
            className="mini"
            onClick={(e) => {
              e.stopPropagation();
              copyAll();
            }}
            title="Copy summary for bug reports"
          >
            Copy
          </button>
        </div>
        {showSys && (
          <dl className="sysinfo">
            {sysRows.map(([k, v]) =>
              v !== null ? (
                <div key={k} className="sysrow" title={v}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ) : null,
            )}
          </dl>
        )}
      </section>

      <section className={`side-sec sep ${showErr ? "grow" : ""}`}>
        <div className="side-head clickable" onClick={() => setShowErr((v) => !v)}>
          {showErr ? "▾" : "▸"} Error summary
        </div>
        {showErr && (
          <>
            <div className="side-counts">
              <span className="icon Log">ⓘ {stats.log.toLocaleString()}</span>
              <span className="icon Warning">⚠ {stats.warning.toLocaleString()}</span>
              <span className="icon Error">
                ⛔ {(stats.error + stats.assert + stats.exception).toLocaleString()}
              </span>
            </div>
            {top.length === 0 ? (
              <p className="side-empty">No errors 🎉</p>
            ) : (
              <div className="top-errors">
                {top.map((r) => (
                  <div
                    key={r.entry.id}
                    className="top-error"
                    title={r.entry.message.split("\n")[0]}
                    onClick={() => onJump(r.entry.id)}
                  >
                    <span className={`icon ${r.entry.level}`}>{LEVEL_ICON[r.entry.level]}</span>
                    <span className="badge">×{(r.count ?? 1).toLocaleString()}</span>
                    <span className="msg">{r.entry.message.split("\n")[0]}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </aside>
  );
}
