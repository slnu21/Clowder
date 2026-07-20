import { getCurrentWindow } from "@tauri-apps/api/window";
import BrandMark from "../../components/BrandMark";
import Icon from "../../components/Icon";
import { cycleRail, useRailMode } from "./panels";
import { useSettings } from "../settings/store";

const appWindow = getCurrentWindow();

const RAIL_LABEL = { full: "세션 레일: 전체", mini: "세션 레일: 좁게", hidden: "세션 레일: 숨김" };

/**
 * Custom window title bar. Native decorations are off (see `tauri.conf.json`), so this is drawn in the
 * webview and follows deck's theme — the native bar rendered a bright OS caption over the dark app on a
 * light-mode Windows, which is what looked broken. The whole bar is a drag region except the controls;
 * double-clicking the drag region toggles maximise (Tauri built-in).
 */
export default function TitleBar() {
  const leftPanel = useSettings((s) => s.settings.leftPanel);
  const update = useSettings((s) => s.update);
  const rail = useRailMode();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-app" data-tauri-drag-region>
        <BrandMark size={18} />
        <span className="titlebar-name" data-tauri-drag-region>
          Clowder
        </span>
        {/* The toggles live here, opposite the window controls, because this is the one strip that is
            still on screen after both panels are collapsed. */}
        <div className="titlebar-panels">
          <button
            type="button"
            className="tb-btn"
            data-on={leftPanel ? "1" : undefined}
            title={leftPanel ? "탐색기 숨기기" : "탐색기 보이기"}
            onClick={() => update({ leftPanel: !leftPanel })}
          >
            <Icon name="panel-left" size={14} />
          </button>
          <button
            type="button"
            className="tb-btn"
            data-on={rail !== "hidden" ? "1" : undefined}
            // Writing the *resolved* mode is what turns "never chosen" into a real choice.
            title={`${RAIL_LABEL[rail]} (클릭해 전환)`}
            onClick={() => update({ rightRail: cycleRail(rail) })}
          >
            <Icon name="panel-right" size={14} />
          </button>
        </div>
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
