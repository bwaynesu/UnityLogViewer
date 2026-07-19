import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isPortable, logAssociation, setLogAssociation } from "./lib/api";
import { LOCALE_NAMES, t, type Locale } from "./lib/i18n";
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
  const commitFs = (pct: number) => set({ fontScale: clampScale(pct / 100) });

  // .log association lives in the registry, not in Settings — the
  // checkbox reflects and writes actual system state.
  const [assoc, setAssoc] = useState<boolean | null>(null);
  const [assocNote, setAssocNote] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  // Auto-update install only applies to installed builds; portable disables it.
  const [portable, setPortable] = useState(false);
  // Font-size slider shows this while dragging; committed to settings on release so
  // the modal doesn't reflow (and slide out from under the cursor) mid-drag.
  const [fsPreview, setFsPreview] = useState(s.fontScale);
  useEffect(() => setFsPreview(s.fontScale), [s.fontScale]);
  useEffect(() => {
    logAssociation().then(setAssoc);
    getVersion().then(setVersion).catch(() => {});
    isPortable().then(setPortable).catch(() => {});
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
          <b>{t("settings")}</b>
          <span className="spacer" />
          <button onClick={() => onChange({ ...DEFAULTS })}>{t("resetAll")}</button>
          <button onClick={onClose}>✕</button>
        </div>

        <h3>{t("appearance")}</h3>
        <label className="setting">
          {t("language")}
          <select
            value={s.language}
            onChange={(e) => set({ language: e.target.value as Settings["language"] })}
          >
            <option value="auto">{t("langAuto")}</option>
            {(Object.keys(LOCALE_NAMES) as Locale[]).map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="setting">
          {t("theme")}
          <select
            value={s.theme}
            onChange={(e) => set({ theme: e.target.value as Settings["theme"] })}
          >
            <option value="light">{t("themeLight")}</option>
            <option value="gray">{t("themeGray")}</option>
            <option value="dark">{t("themeDark")}</option>
          </select>
        </label>
        <label className="setting">
          {t("fontSize")} ({Math.round(fsPreview * 100)}%)
          <input
            type="range"
            min={70}
            max={200}
            step={10}
            value={fsPreview * 100}
            onChange={(e) => setFsPreview(clampScale(Number(e.target.value) / 100))}
            onPointerUp={(e) => commitFs(Number(e.currentTarget.value))}
            onKeyUp={(e) => commitFs(Number(e.currentTarget.value))}
          />
          <span className="hint">{t("ctrlWheelHint")}</span>
        </label>
        <label className="setting">
          <input
            type="checkbox"
            checked={s.showIndex}
            onChange={(e) => set({ showIndex: e.target.checked })}
          />
          {t("showIndexCol")}
        </label>
        <label className="setting">
          <input
            type="checkbox"
            checked={s.rowTint}
            onChange={(e) => set({ rowTint: e.target.checked })}
          />
          {t("tintRows")}
        </label>
        {s.rowTint && (
          <>
            <label className="setting sub">
              {t("warningTint")}
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
              {t("errorTint")}
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

        <h3>{t("behavior")}</h3>
        <label className="setting">
          {t("openAt")}
          <select
            value={s.openAt}
            onChange={(e) => set({ openAt: e.target.value as Settings["openAt"] })}
          >
            <option value="bottom">{t("openAtBottom")}</option>
            <option value="top">{t("openAtTop")}</option>
          </select>
        </label>

        <h3>{t("homeScan")}</h3>
        <label className="setting">
          {t("scanDepth")}
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
            {t("addFolder")}
          </button>
          <span className="hint">{t("besidesLocalLow")}</span>
        </div>

        <h3>{t("system")}</h3>
        <label className="setting">
          <input
            type="checkbox"
            checked={assoc === true}
            disabled={assoc === null}
            onChange={(e) => toggleAssoc(e.target.checked)}
          />
          {t("assocLabel")}
          <span className="hint">{t("windowsOnly")}</span>
        </label>
        {assocNote && <div className="assoc-note">{assocNote}</div>}
        <label className="setting">
          {t("updates")}
          <select
            value={portable && s.updates === "auto" ? "notify" : s.updates}
            onChange={(e) => set({ updates: e.target.value as Settings["updates"] })}
          >
            <option value="off">{t("updatesOff")}</option>
            <option value="notify">{t("updatesNotify")}</option>
            <option value="auto" disabled={portable}>
              {t("updatesAuto")}
            </option>
          </select>
          {portable && <span className="hint">{t("autoNeedsInstaller")}</span>}
        </label>

        <h3>{t("ide")}</h3>
        <label className="setting">
          {t("customCommand")}
          <input
            className="wide"
            value={s.ideTemplate}
            onChange={(e) => set({ ideTemplate: e.target.value })}
            placeholder={t("idePlaceholder")}
            title={t("ideTitle")}
          />
        </label>

        <h3>{t("about")}</h3>
        <div className="about">
          <div>Unity Log Viewer{version && ` v${version}`}</div>
          <div>Copyright © 2026 bwaynesu</div>
          <div>
            {t("license")}: <a onClick={() => openUrl(LICENSE_URL)}>AGPL-3.0-or-later</a>
          </div>
          <div>{t("noWarranty")}</div>
          <div>
            <a onClick={() => openUrl(REPO_URL)}>{t("sourceCode")}</a>
          </div>
        </div>
      </div>
    </div>
  );
}
