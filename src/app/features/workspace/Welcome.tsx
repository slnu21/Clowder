import { open } from "@tauri-apps/plugin-dialog";
import Icon from "../../components/Icon";
import { useT } from "../../lib/i18n";
import { useSettings } from "../settings/store";
import { basename } from "./model";
import { useWorkspace } from "./store";

/**
 * Shown in the workspace when no tab is open — the first-launch state (item 2: no forced terminal) and
 * whenever the last tab is closed. Offers the ways in: open a folder as a terminal, a blank terminal,
 * or jump straight to a favourite.
 */
export default function Welcome() {
  const t = useT();
  const openTerminalTab = useWorkspace((s) => s.openTerminalTab);
  const newTab = useWorkspace((s) => s.newTab);
  const favorites = useSettings((s) => s.settings.favorites);

  const pickFolder = async () => {
    const picked = await open({ multiple: false, directory: true });
    if (typeof picked === "string") openTerminalTab(picked);
  };

  return (
    <div className="welcome">
      <div className="welcome-brand">
        <span className="welcome-dot" />
        Clowder
      </div>
      <p className="welcome-hint">{t("welcome.hint")}</p>

      <div className="welcome-actions">
        <button type="button" onClick={pickFolder}>
          <Icon name="folder" size={15} />
          {t("welcome.openFolder")}
        </button>
        <button type="button" onClick={newTab}>
          <Icon name="terminal" size={15} />
          {t("welcome.newTerminal")}
        </button>
      </div>

      {favorites.length > 0 && (
        <div className="welcome-favs">
          <div className="welcome-favs-label">{t("common.favorites")}</div>
          {favorites.map((f) => (
            <button key={f} type="button" className="welcome-fav" onClick={() => openTerminalTab(f)} title={f}>
              <Icon name="folder" size={14} className="folder" />
              <span className="welcome-fav-name">{basename(f)}</span>
              <span className="welcome-fav-path">{f}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
