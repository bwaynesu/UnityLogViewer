import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { logAssociation, setLogAssociation } from "./lib/api";
import { clampScale, DEFAULTS, type Settings } from "./lib/settings";

const REPO_URL = "https://github.com/bwaynesu/UnityLogViewer";
const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}

/** Settings dialog. Sections; split into tabs only if this outgrows one screen. */
export default function SettingsModal({ settings: s, onChange, onClose }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });

  // .log association lives in the registry, not in Settings — the
  // checkbox reflects and writes actual system state.
  const [assoc, setAssoc] = useState<boolean | null>(null);
  const [assocNote, setAssocNote] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    logAssociation().then(setAssoc);
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const toggleAssoc = (enable: boolean) => {
    setAssocNote(null);
    setLogAssociation(enable)
      // re-query real state: Windows may keep another default (UserChoice)
      .then((note) => {
        setAssocNote(note || null);
        return logAssociation();
      })
      .then(setAssoc)
      .catch((e) => setAssocNote(String(e)));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Settings</b>
          <span className="spacer" />
          <button onClick={() => onChange({ ...DEFAULTS })}>Reset all</button>
          <button onClick={onClose}>✕</button>
        </div>

        <h3>Appearance</h3>
        <label className="setting">
          Theme
          <select
            value={s.theme}
            onChange={(e) => set({ theme: e.target.value as Settings["theme"] })}
          >
            <option value="light">Light</option>
            <option value="gray">Gray</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="setting">
          Font size ({Math.round(s.fontScale * 100)}%)
          <input
            type="range"
            min={70}
            max={200}
            step={10}
            value={s.fontScale * 100}
            onChange={(e) => set({ fontScale: clampScale(Number(e.target.value) / 100) })}
          />
          <span className="hint">Ctrl+wheel to zoom</span>
        </label>
        <label className="setting">
          <input
            type="checkbox"
            checked={s.showIndex}
            onChange={(e) => set({ showIndex: e.target.checked })}
          />
          Show entry index column
        </label>
        <label className="setting">
          <input
            type="checkbox"
            checked={s.rowTint}
            onChange={(e) => set({ rowTint: e.target.checked })}
          />
          Tint warning / error rows
        </label>
        {s.rowTint && (
          <>
            <label className="setting sub">
              Warning tint
              <input
                type="color"
                value={s.warningTint}
                onChange={(e) => set({ warningTint: e.target.value })}
              />
              <input
                type="range"
                min={0}
                max={50}
                value={s.warningAlpha * 100}
                onChange={(e) => set({ warningAlpha: Number(e.target.value) / 100 })}
              />
              <span className="hint">{Math.round(s.warningAlpha * 100)}%</span>
            </label>
            <label className="setting sub">
              Error tint
              <input
                type="color"
                value={s.errorTint}
                onChange={(e) => set({ errorTint: e.target.value })}
              />
              <input
                type="range"
                min={0}
                max={50}
                value={s.errorAlpha * 100}
                onChange={(e) => set({ errorAlpha: Number(e.target.value) / 100 })}
              />
              <span className="hint">{Math.round(s.errorAlpha * 100)}%</span>
            </label>
          </>
        )}

        <h3>Behavior</h3>
        <label className="setting">
          After opening a file, scroll to
          <select
            value={s.openAt}
            onChange={(e) => set({ openAt: e.target.value as Settings["openAt"] })}
          >
            <option value="bottom">Bottom (newest)</option>
            <option value="top">Top</option>
          </select>
        </label>

        <h3>Home page scan</h3>
        <label className="setting">
          Scan depth (subfolder levels)
          <input
            type="number"
            min={0}
            max={5}
            value={s.scanDepth}
            onChange={(e) =>
              set({ scanDepth: Math.min(5, Math.max(0, Math.round(Number(e.target.value) || 0))) })
            }
          />
        </label>
        {s.scanFolders.map((f) => (
          <div key={f} className="setting">
            <span className="folder" title={f}>
              {f}
            </span>
            <button
              className="mini"
              onClick={() => set({ scanFolders: s.scanFolders.filter((x) => x !== f) })}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="setting">
          <button
            onClick={async () => {
              const dir = await openDialog({ directory: true });
              if (typeof dir === "string" && !s.scanFolders.includes(dir)) {
                set({ scanFolders: [...s.scanFolders, dir] });
              }
            }}
          >
            Add folder…
          </button>
          <span className="hint">Besides LocalLow</span>
        </div>

        <h3>System</h3>
        <label className="setting">
          <input
            type="checkbox"
            checked={assoc === true}
            disabled={assoc === null}
            onChange={(e) => toggleAssoc(e.target.checked)}
          />
          Open .log files with Unity Log Viewer (double-click)
          <span className="hint">Windows only</span>
        </label>
        {assocNote && <div className="assoc-note">{assocNote}</div>}
        <label className="setting">
          Updates
          <select value={s.updates} onChange={(e) => set({ updates: e.target.value as Settings["updates"] })}>
            <option value="off">Off</option>
            <option value="notify">Notify me (download myself)</option>
            <option value="auto">Download &amp; install automatically</option>
          </select>
          <span className="hint">Auto needs the installer build</span>
        </label>

        <h3>IDE</h3>
        <label className="setting">
          Custom command
          <input
            className="wide"
            value={s.ideTemplate}
            onChange={(e) => set({ ideTemplate: e.target.value })}
            placeholder="blank = auto (Visual Studio solution → system default)"
            title="Advanced override. {path} and {line} are substituted, e.g. code -g &quot;{path}:{line}&quot;"
          />
        </label>

        <h3>About</h3>
        <div className="about">
          <div>Unity Log Viewer{version && ` v${version}`}</div>
          <div>Copyright © 2026 bwaynesu</div>
          <div>
            Licensed under{" "}
            <a onClick={() => openUrl(LICENSE_URL)}>AGPL-3.0-or-later</a>. This program comes with
            absolutely no warranty.
          </div>
          <div>
            <a onClick={() => openUrl(REPO_URL)}>Source code</a>
          </div>
        </div>
      </div>
    </div>
  );
}
