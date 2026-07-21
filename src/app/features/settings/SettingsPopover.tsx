import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import { useSettings } from "./store";

/** Accent choices — key persisted to settings, swatch shown in the picker (dark-mode hex as reference). */
const ACCENTS = [
  { key: "amber", label: "앰버", swatch: "#c8a15c" },
  { key: "sage", label: "세이지", swatch: "#9fae7a" },
  { key: "clay", label: "클레이", swatch: "#c78a6a" },
  { key: "neutral", label: "뉴트럴", swatch: "#b8b1a4" },
] as const;

/** Chrome scale presets. Fixed rungs, not a free field — see the note where they're rendered. */
const UI_SCALES = [0.9, 1, 1.15, 1.3, 1.5] as const;

/**
 * The whole settings surface: a gear button that opens one popover (no settings window, no SQLite —
 * a single `%APPDATA%\deck\settings.json`, following Vigil's pattern). Harvests md-reader's
 * SettingsPopover shape: outside-click and Esc close it.
 *
 * Shell / font / size / scrollback apply to **newly opened** terminals; existing panes keep theirs.
 */
export default function SettingsPopover() {
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
      const t = e.target as Node;
      // The popover is portalled out of the wrap, so check both the gear and the popover.
      if (gearRef.current?.contains(t) || popRef.current?.contains(t)) return;
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
        title="설정"
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
            aria-label="설정"
            ref={popRef}
            style={{ top: pos.top, left: pos.left }}
          >
          <div className="set-group">모양</div>

          <div className="set-row">
            <span>테마</span>
            <div className="set-seg">
              {(["dark", "light"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={s.theme === k}
                  className={s.theme === k ? "on" : ""}
                  onClick={() => update({ theme: k })}
                >
                  {k === "dark" ? "다크" : "라이트"}
                </button>
              ))}
            </div>
          </div>

          <div className="set-row">
            <span>액센트</span>
            <div className="set-accent">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  title={a.label}
                  aria-label={a.label}
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
            <span>UI 크기</span>
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

          <div className="set-group">셸</div>

          <div className="set-row">
            <span>기본 셸</span>
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
            <span>Git Bash 경로</span>
            <span className="set-pathpick">
              <input
                type="text"
                value={s.gitBashPath ?? ""}
                placeholder="자동 탐색"
                onChange={(e) => update({ gitBashPath: e.target.value || null })}
              />
              <button
                type="button"
                onClick={async () => {
                  const p = await pickFile({ name: "bash", extensions: ["exe"] });
                  if (p) update({ gitBashPath: p });
                }}
              >
                찾기
              </button>
            </span>
          </div>

          <div className="set-group">터미널</div>

          <label className="set-row">
            <span>글꼴</span>
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
            <span>크기</span>
            <input
              type="number"
              min={8}
              max={32}
              value={s.terminalFontSize}
              onChange={(e) => update({ terminalFontSize: clamp(Number(e.target.value), 8, 32, 14) })}
            />
          </label>

          <label className="set-row">
            <span>스크롤백</span>
            <input
              type="number"
              min={100}
              max={100000}
              step={500}
              value={s.scrollback}
              onChange={(e) => update({ scrollback: clamp(Number(e.target.value), 100, 100000, 5000) })}
            />
          </label>

          <div className="set-group">탐색기</div>

          <div className="set-row">
            <span>시작 경로</span>
            <span className="set-pathpick">
              <input
                type="text"
                value={s.startPath ?? ""}
                placeholder="홈"
                onChange={(e) => update({ startPath: e.target.value || null })}
              />
              <button
                type="button"
                onClick={async () => {
                  const p = await pickDir();
                  if (p) update({ startPath: p });
                }}
              >
                찾기
              </button>
            </span>
          </div>

          <div className="set-row set-col">
            <span>즐겨찾기</span>
            <div className="set-favs">
              {s.favorites.map((f) => (
                <div className="set-fav" key={f} title={f}>
                  <span className="set-fav-path">{f}</span>
                  <button
                    type="button"
                    title="제거"
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
                + 추가
              </button>
            </div>
          </div>

          <div className="set-note">
            UI 크기·테마·액센트는 즉시 적용됩니다. 터미널 글꼴·크기는 별개 설정이고, 셸·스크롤백과 함께
            새로 여는 터미널부터 반영됩니다.
          </div>
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
