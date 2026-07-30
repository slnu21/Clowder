import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import { useT } from "../../lib/i18n";
import { useSettings } from "./store";

/** Accent choices — key persisted to settings, swatch shown in the picker (dark-mode hex as reference). */
const ACCENTS = [
  { key: "amber", labelKey: "settings.accentAmber", swatch: "#c8a15c" },
  { key: "sage", labelKey: "settings.accentSage", swatch: "#9fae7a" },
  { key: "clay", labelKey: "settings.accentClay", swatch: "#c78a6a" },
  { key: "neutral", labelKey: "settings.accentNeutral", swatch: "#b8b1a4" },
] as const;

/** Chrome scale presets. Fixed rungs, not a free field — see the note where they're rendered. */
const UI_SCALES = [0.9, 1, 1.15, 1.3, 1.5] as const;

/** Language choices. The names are written in their own language, as is conventional — a reader who
 *  needs "English" cannot necessarily read "영어". */
const LANGUAGES = [
  { key: "auto", label: null },
  { key: "ko", label: "한국어" },
  { key: "en", label: "English" },
] as const;

/**
 * The whole settings surface: a gear button that opens one popover (no settings window, no SQLite —
 * a single `%APPDATA%\deck\settings.json`, following Vigil's pattern). Harvests md-reader's
 * SettingsPopover shape: outside-click and Esc close it.
 *
 * Shell / font / size / scrollback apply to **newly opened** terminals; existing panes keep theirs.
 */
export default function SettingsPopover() {
  const t = useT();
  const [openState, setOpenState] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const gearRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);

  // Anchor the portalled popover under the gear; recompute on open and on window resize.
  useLayoutEffect(() => {
    if (!openState) return;
    const place = () => {
      const g = gearRef.current?.getBoundingClientRect();
      if (!g) return;
      // Must track the CSS width, which scales with --ui-scale — otherwise the viewport clamp uses the
      // wrong width and the (now wider) popover spills off the right edge at high scales.
      const margin = 8;
      const width = Math.min(292 * s.uiScale, window.innerWidth * 0.92);
      setPos({
        top: g.bottom + 6,
        left: Math.min(Math.max(margin, g.left), window.innerWidth - width - margin),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [openState, s.uiScale]);

  useEffect(() => {
    if (!openState) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      // The popover is portalled out of the wrap, so check both the gear and the popover.
      if (gearRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpenState(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenState(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [openState]);

  const pickFile = async (filter?: { name: string; extensions: string[] }) => {
    const picked = await open({ multiple: false, directory: false, filters: filter ? [filter] : undefined });
    return typeof picked === "string" ? picked : null;
  };
  const pickDir = async () => {
    const picked = await open({ multiple: false, directory: true });
    return typeof picked === "string" ? picked : null;
  };

  return (
    <div className="settings-wrap">
      <button
        ref={gearRef}
        type="button"
        className="settings-gear"
        title={t("settings.title")}
        aria-expanded={openState}
        onClick={() => setOpenState((v) => !v)}
      >
        <Icon name="settings" size={15} />
      </button>

      {openState &&
        createPortal(
          <div
            className="settings-pop"
            role="dialog"
            aria-label={t("settings.title")}
            ref={popRef}
            style={{ top: pos.top, left: pos.left }}
          >
          <div className="set-group">{t("settings.groupAppearance")}</div>

          <div className="set-row">
            <span>{t("settings.theme")}</span>
            <div className="set-seg">
              {(["dark", "light"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={s.theme === k}
                  className={s.theme === k ? "on" : ""}
                  onClick={() => update({ theme: k })}
                >
                  {k === "dark" ? t("settings.themeDark") : t("settings.themeLight")}
                </button>
              ))}
            </div>
          </div>

          <div className="set-row">
            <span>{t("settings.accent")}</span>
            <div className="set-accent">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  title={t(a.labelKey)}
                  aria-label={t(a.labelKey)}
                  aria-pressed={s.accent === a.key}
                  className={s.accent === a.key ? "on" : ""}
                  style={{ ["--sw"]: a.swatch } as React.CSSProperties}
                  onClick={() => update({ accent: a.key })}
                />
              ))}
            </div>
          </div>

          {/* Full-width row: five presets don't fit beside a label, so the segment gets its own line and
              the buttons share the width evenly. */}
          <div className="set-row set-col">
            <span>{t("settings.uiScale")}</span>
            {/* Presets, not a free number: 1.37 lands no step on a whole pixel and the hinting turns to
                mush. Chrome only — the terminal keeps its own font size. */}
            <div className="set-seg">
              {UI_SCALES.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={s.uiScale === v}
                  className={s.uiScale === v ? "on" : ""}
                  onClick={() => update({ uiScale: v })}
                >
                  {Math.round(v * 100)}%
                </button>
              ))}
            </div>
          </div>

          <div className="set-row">
            <span>{t("settings.language")}</span>
            <div className="set-seg">
              {LANGUAGES.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  aria-pressed={s.language === l.key}
                  className={s.language === l.key ? "on" : ""}
                  onClick={() => update({ language: l.key })}
                >
                  {l.label ?? t("settings.languageAuto")}
                </button>
              ))}
            </div>
          </div>

          <div className="set-group">{t("settings.groupShell")}</div>

          <div className="set-row">
            <span>{t("settings.defaultShell")}</span>
            <div className="set-seg">
              {(["bash", "powershell"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={s.shell === k}
                  className={s.shell === k ? "on" : ""}
                  onClick={() => update({ shell: k })}
                >
                  {k === "bash" ? "Git Bash" : "PowerShell"}
                </button>
              ))}
            </div>
          </div>

          <div className="set-row">
            <span>{t("settings.gitBashPath")}</span>
            <span className="set-pathpick">
              <input
                type="text"
                value={s.gitBashPath ?? ""}
                placeholder={t("settings.autoDetect")}
                onChange={(e) => update({ gitBashPath: e.target.value || null })}
              />
              <button
                type="button"
                onClick={async () => {
                  const p = await pickFile({ name: "bash", extensions: ["exe"] });
                  if (p) update({ gitBashPath: p });
                }}
              >
                {t("common.browse")}
              </button>
            </span>
          </div>

          <div className="set-group">{t("settings.groupTerminal")}</div>

          <div className="set-row" title={t("settings.termThemeTitle")}>
            <span>{t("settings.theme")}</span>
            <div className="set-seg">
              {(["follow", "dark", "light"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={s.terminalTheme === k}
                  className={s.terminalTheme === k ? "on" : ""}
                  onClick={() => update({ terminalTheme: k })}
                >
                  {k === "follow"
                    ? t("settings.termFollow")
                    : k === "dark"
                      ? t("settings.themeDark")
                      : t("settings.themeLight")}
                </button>
              ))}
            </div>
          </div>

          <label className="set-row">
            <span>{t("settings.font")}</span>
            <input
              type="text"
              value={s.terminalFont}
              list="deck-fonts"
              onChange={(e) => update({ terminalFont: e.target.value })}
            />
          </label>
          <datalist id="deck-fonts">
            {["D2Coding", "Cascadia Mono", "Cascadia Code", "Consolas", "JetBrains Mono", "MesloLGS NF"].map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>

          <label className="set-row">
            <span>{t("settings.size")}</span>
            <input
              type="number"
              min={8}
              max={32}
              value={s.terminalFontSize}
              onChange={(e) => update({ terminalFontSize: clamp(Number(e.target.value), 8, 32, 14) })}
            />
          </label>

          <label className="set-row">
            <span>{t("settings.scrollback")}</span>
            <input
              type="number"
              min={100}
              max={100000}
              step={500}
              value={s.scrollback}
              onChange={(e) => update({ scrollback: clamp(Number(e.target.value), 100, 100000, 5000) })}
            />
          </label>

          <div className="set-group">{t("settings.groupExplorer")}</div>

          <div className="set-row">
            <span>{t("settings.startPath")}</span>
            <span className="set-pathpick">
              <input
                type="text"
                value={s.startPath ?? ""}
                placeholder={t("settings.home")}
                onChange={(e) => update({ startPath: e.target.value || null })}
              />
              <button
                type="button"
                onClick={async () => {
                  const p = await pickDir();
                  if (p) update({ startPath: p });
                }}
              >
                {t("common.browse")}
              </button>
            </span>
          </div>

          <div className="set-row set-col">
            <span>{t("common.favorites")}</span>
            <div className="set-favs">
              {s.favorites.map((f) => (
                <div className="set-fav" key={f} title={f}>
                  <span className="set-fav-path">{f}</span>
                  <button
                    type="button"
                    title={t("common.remove")}
                    onClick={() => update({ favorites: s.favorites.filter((x) => x !== f) })}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="set-fav-add"
                onClick={async () => {
                  const p = await pickDir();
                  if (p && !s.favorites.includes(p)) update({ favorites: [...s.favorites, p] });
                }}
              >
                {t("settings.addFavorite")}
              </button>
            </div>
          </div>

          <div className="set-note">{t("settings.footer")}</div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
