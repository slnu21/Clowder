import { getCurrentWindow } from "@tauri-apps/api/window";
import Icon from "../../components/Icon";

const appWindow = getCurrentWindow();

/**
 * Custom window title bar. Native decorations are off (see `tauri.conf.json`), so this is drawn in the
 * webview and follows deck's theme — the native bar rendered a bright OS caption over the dark app on a
 * light-mode Windows, which is what looked broken. The whole bar is a drag region except the controls;
 * double-clicking the drag region toggles maximise (Tauri built-in).
 */
export default function TitleBar() {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-app" data-tauri-drag-region>
        <Icon name="terminal" size={14} />
        <span className="titlebar-name" data-tauri-drag-region>
          deck
        </span>
      </div>
      <div className="titlebar-controls">
        <button type="button" className="tb-btn" title="최소화" onClick={() => void appWindow.minimize()}>
          <Icon name="minimize" size={14} />
        </button>
        <button type="button" className="tb-btn" title="최대화" onClick={() => void appWindow.toggleMaximize()}>
          <Icon name="maximize" size={12} />
        </button>
        <button type="button" className="tb-btn tb-close" title="닫기" onClick={() => void appWindow.close()}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  );
}
