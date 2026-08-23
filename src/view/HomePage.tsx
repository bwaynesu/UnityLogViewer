import { openUrl } from "@tauri-apps/plugin-opener";
import type { LocalLog } from "../lib/api";
import { t } from "../lib/i18n";
import { fileName, fmtSize } from "./common";
import "./HomePage.css";

interface Props {
  recent: string[];
  localLogs: LocalLog[];
  watched: LocalLog[];
  error: string | null;
  onPickFile: () => void;
  onOpen: (path: string) => void;
}

/** Shown when no file is open (startup, or a "+" tab). Pure view. */
export default function HomePage({ recent, localLogs, watched, error, onPickFile, onOpen }: Props) {
  const column = (title: string, logs: LocalLog[]) =>
    logs.length > 0 && (
      <div className="empty-col">
        <h3>{title}</h3>
        {logs.slice(0, 12).map((l) => (
          <button key={l.path} className="empty-item" title={l.path} onClick={() => onOpen(l.path)}>
            {fileName(l.path)}
            <span className="hint">
              {l.game} · {fmtSize(l.size)} · {new Date(l.modifiedMs).toLocaleDateString()}
            </span>
          </button>
        ))}
      </div>
    );

  return (
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
        <p className="drop-hint" onClick={onPickFile}>
          {t("dropHint")}
        </p>
        {error && <p className="error-text">{error}</p>}
        <div className="empty-cols">
          {recent.length > 0 && (
            <div className="empty-col">
              <h3>{t("recent")}</h3>
              {recent.map((p) => (
                <button key={p} className="empty-item" title={p} onClick={() => onOpen(p)}>
                  {fileName(p)}
                  <span className="hint">{p}</span>
                </button>
              ))}
            </div>
          )}
          {column(t("localLogs"), localLogs)}
          {column(t("watchedFolders"), watched)}
        </div>
      </div>
    </div>
  );
}
