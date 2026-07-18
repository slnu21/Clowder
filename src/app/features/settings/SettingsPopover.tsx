import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import Icon from "../../components/Icon";
import { useSettings } from "./store";

/** Accent choices — key persisted to settings, swatch shown in the picker (dark-mode hex as reference). */
const ACCENTS = [
  { key: "amber", label: "앰버", swatch: "#c8a15c" },
  { key: "sage", label: "세이지", swatch: "#9fae7a" },
  { key: "clay", label: "클레이", swatch: "#c78a6a" },
  { key: "neutral", label: "뉴트럴", swatch: "#b8b1a4" },
] as const;

/**
 * The whole settings surface: a gear button that opens one popover (no settings window, no SQLite —
 * a single `%APPDATA%\deck\settings.json`, following Vigil's pattern). Harvests md-reader's
 * SettingsPopover shape: outside-click and Esc close it.
 *
 * Shell / font / size / scrollback apply to **newly opened** terminals; existing panes keep theirs.
 */
export default function SettingsPopover() {
  const [openState, setOpenState] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);

  useEffect(() => {
    if (!openState) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpenState(false);
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
    <div className="settings-wrap" ref={wrapRef}>
      <button
        type="button"
        className="settings-gear"
        title="설정"
        aria-expanded={openState}
        onClick={() => setOpenState((v) => !v)}
      >
        <Icon name="settings" size={15} />
      </button>

      {openState && (
        <div className="settings-pop" role="dialog" aria-label="설정">
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

          <div className="set-note">셸·글꼴·크기·스크롤백은 새로 여는 터미널부터 적용됩니다.</div>
        </div>
      )}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
