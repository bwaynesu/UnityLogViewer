import type { StackFrame } from "../lib/api";
import { t } from "../lib/i18n";
import "./NoticeBar.css";

export interface Notice {
  text: string;
  copyPath?: string;
  /** "Set project root…" retries this frame once a root is picked. */
  retryFrame?: StackFrame;
  /** One-click self-install; installer builds only. */
  autoAction?: { label: string; run: () => void };
  /** e.g. Download (opens the page) / Restart. */
  action?: { label: string; run: () => void };
}

interface Props {
  notice: Notice;
  onSetRoot: (frame: StackFrame) => void;
  onClose: () => void;
}

/** Update and error notices. Rendered by BOTH the home and viewer branches. */
export default function NoticeBar({ notice, onSetRoot, onClose }: Props) {
  return (
    <div className="notice">
      <span className="msg">{notice.text}</span>
      {notice.retryFrame && (
        <button className="mini" onClick={() => onSetRoot(notice.retryFrame!)}>
          {t("setProjectRoot")}
        </button>
      )}
      {notice.copyPath && (
        <button className="mini" onClick={() => navigator.clipboard.writeText(notice.copyPath!)}>
          {t("copyPath")}
        </button>
      )}
      {notice.autoAction && (
        <button className="mini" onClick={() => notice.autoAction!.run()}>
          {notice.autoAction.label}
        </button>
      )}
      {notice.action && (
        <button className="mini" onClick={() => notice.action!.run()}>
          {notice.action.label}
        </button>
      )}
      <button className="mini" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
