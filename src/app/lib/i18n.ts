import { create } from "zustand";
import { useMemo } from "react";

/**
 * UI strings, ko + en.
 *
 * Hand-rolled rather than react-i18next: ~140 strings with no plural rules, no
 * date/number formatting, and no lazy-loaded namespaces. A dependency that
 * solves none of those would only add weight and a second place to look.
 *
 * `lib` stays a leaf (it must not import `features`), so the *current language*
 * lives in its own tiny store here and the settings store pushes into it via
 * `setLanguage`. Components read `useT()`.
 */

export type Lang = "ko" | "en";
/** What the user picked. `"auto"` follows the OS/browser locale. */
export type LanguageSetting = "auto" | Lang;

const KO = {
  "common.refresh": "새로고침",
  "common.loading": "읽는 중…",
  "common.noActiveTerminal": "활성 터미널 없음",
  "common.open": "열기",
  "common.remove": "제거",
  "common.delete": "삭제",
  "common.add": "추가",
  "common.browse": "찾기",
  "common.favorites": "즐겨찾기",

  "titlebar.hideExplorer": "탐색기 숨기기",
  "titlebar.showExplorer": "탐색기 보이기",
  "titlebar.railFull": "세션 레일: 전체",
  "titlebar.railMini": "세션 레일: 좁게",
  "titlebar.railHidden": "세션 레일: 숨김",
  "titlebar.railToggle": "{label} (클릭해 전환)",
  "titlebar.minimize": "최소화",
  "titlebar.maximize": "최대화",
  "titlebar.close": "닫기",

  "explorer.tab": "탐색기",
  "explorer.openTerminalHere": "여기서 터미널 열기",
  "explorer.openInViewer": "열기 (뷰어)",
  "explorer.addFavorite": "즐겨찾기에 추가",
  "explorer.removeFavorite": "즐겨찾기에서 제거",
  "explorer.myComputer": "내 컴퓨터",
  "explorer.drives": "드라이브",
  "explorer.parentFolder": "상위 폴더",

  "workspace.splitRow": "좌우 분할",
  "workspace.splitColumn": "상하 분할",
  "workspace.closePane": "닫기",
  "workspace.copyView": "화면 복사",
  "workspace.paste": "붙여넣기",
  "workspace.selectAll": "모두 선택",
  "workspace.resetTerminal": "터미널 재설정",
  "workspace.resetTerminalHint": "마우스를 움직이면 글자가 찍히거나 화면이 굳었을 때 — 화면을 지우고 터미널 모드를 초기화합니다",
  "workspace.selectionHint": "Shift+드래그로 부분 선택",
  "workspace.closeTab": "탭 닫기",
  "workspace.newTab": "새 탭",
  "workspace.paneColor": "페인 색",
  "workspace.colorDefault": "기본",
  "workspace.colorSwatch": "색 {n}",

  "welcome.hint": "폴더를 열어 터미널을 시작하거나, 즐겨찾기에서 선택하세요.",
  "welcome.openFolder": "폴더 열기…",
  "welcome.newTerminal": "새 터미널",

  "sessions.header": "세션",
  "sessions.railMini": "세션 레일 (좁게)",
  "sessions.statusAwaitingPermission": "승인 대기",
  "sessions.statusAwaitingInput": "대기 중",
  "sessions.statusWorking": "동작 중",
  "sessions.statusIdle": "유휴",
  "sessions.statusDead": "종료됨",
  "sessions.statuslineTitle": "상태줄을 쓸까요?",
  "sessions.statuslineBody":
    "사용량(컨텍스트·5시간·7일)은 Claude Code 상태줄로 들어옵니다. 지금 쓰는 상태줄이 없어서, Clowder가 상태줄에 무엇을 그릴지 고를 수 있어요. 나중에 끄면 상태줄 설정은 원래대로 (없던 상태로) 돌아갑니다.",
  "sessions.statuslineUsageOnly": "사용량만 수집 (상태줄 비움)",
  "sessions.statuslineClowder": "Clowder 상태줄 쓰기 (폴더·모델·ctx·5h)",
  "sessions.offTitle": "세션 추적이 꺼져 있어요",
  "sessions.offBody":
    "설치하면 실행 중인 Claude Code 세션·상태와 사용량(컨텍스트·5시간·7일)이 여기 표시됩니다. Claude Code 훅을 추가하고 상태줄(statusline)로 사용량을 읽습니다. 기존 상태줄과 설정은 백업·보존해, 끄면 원래대로 되돌립니다.",
  "sessions.brokenTitle": "사용량 수집이 끊겨 있어요",
  "sessions.brokenBody":
    "세션 훅은 설치돼 있지만 상태줄이 Clowder에 연결돼 있지 않습니다 — 세션 목록은 뜨고 사용량(컨텍스트·5시간·7일)만 비어 있는 상태예요. 다시 설치하면 상태줄만 연결합니다.",
  "sessions.installing": "설치 중…",
  "sessions.install": "세션 추적 설치",
  "sessions.reinstall": "다시 설치",
  "sessions.none": "세션 없음",
  "sessions.trackLoc": "추적 위치",
  "sessions.trackMissing": "추적 파일 없음",
  "sessions.openFolder": "폴더 열기",
  "sessions.uninstallTitle": "Clowder 훅·상태줄 래퍼만 제거 — 기존 statusline·다른 설정은 원복/보존",
  "sessions.uninstall": "세션 추적 끄기",
  "sessions.jumpToPane": "이 세션의 페인으로 이동",
  "sessions.runningHere": "이 페인에서 실행 중",
  // "세션 종료"가 아니라 "카드 제거" — Claude를 죽이는 게 아니라 목록에서 치우는 것이고,
  // 살아 있는 세션이면 다음 훅에 다시 나타난다.
  "sessions.dismiss": "카드 제거",
  "sessions.dismissDead": "종료된 세션 정리",
  "sessions.ownerUnknown": "소유 프로세스를 확인할 수 없어 자동으로 정리되지 않습니다 — 직접 제거하세요",
  "sessions.meterCtx": "컨텍스트 {pct}% (상단 세션)",
  "sessions.meterFiveHour": "5시간 {pct}%",
  "sessions.meterSevenDay": "7일 {pct}%",
  "sessions.fiveHour": "5시간",
  "sessions.sevenDay": "7일",

  "settings.title": "설정",
  "settings.groupAppearance": "모양",
  "settings.theme": "테마",
  "settings.themeDark": "다크",
  "settings.themeLight": "라이트",
  "settings.accent": "액센트",
  "settings.accentAmber": "앰버",
  "settings.accentSage": "세이지",
  "settings.accentClay": "클레이",
  "settings.accentNeutral": "뉴트럴",
  "settings.uiScale": "UI 크기",
  "settings.language": "언어",
  "settings.languageAuto": "시스템",
  "settings.groupShell": "셸",
  "settings.defaultShell": "기본 셸",
  "settings.gitBashPath": "Git Bash 경로",
  "settings.autoDetect": "자동 탐색",
  "settings.groupTerminal": "터미널",
  "settings.termThemeTitle":
    "터미널 색은 앱 테마와 별개입니다. 대부분의 CLI 색상표가 어두운 배경 기준이라 라이트 앱에서도 다크 터미널이 잘 보입니다.",
  "settings.termFollow": "앱 따라",
  "settings.font": "글꼴",
  "settings.size": "크기",
  "settings.scrollback": "스크롤백",
  "settings.groupExplorer": "탐색기",
  "settings.startPath": "시작 경로",
  "settings.home": "홈",
  "settings.addFavorite": "+ 추가",
  "settings.footer":
    "UI 크기·테마·액센트·언어는 즉시 적용됩니다. 터미널 글꼴·크기는 별개 설정이고, 셸·스크롤백과 함께 새로 여는 터미널부터 반영됩니다.",

  "git.missing": "git 미설치",
  "git.notRepo": "저장소 아님",
  "git.clean": "깨끗함",
  "git.staged": "스테이지",
  "git.unstaged": "변경",
  "git.untracked": "추적 안 됨",
  "git.conflicts": "충돌",

  "ports.title": "수신 포트",
  "ports.hideSystem": "시스템 포트 숨기기",
  "ports.showSystem": "시스템 포트 표시",
  "ports.showSystemN": "시스템 포트 표시 ({n})",
  "ports.system": "시스템",
  "ports.none": "수신 포트 없음",
  "ports.noneUser": "사용자 포트 없음",
  "ports.killTitle": "PID {pid} 종료",
  "ports.kill": "종료",
  "ports.failed": "실패",

  "docker.containers": "컨테이너",
  "docker.none": "컨테이너 없음",
  "docker.start": "시작",
  "docker.stop": "정지",

  "k8s.context": "컨텍스트",
  "k8s.cluster": "클러스터",
  "k8s.load": "불러오기",
  "k8s.namespace": "네임스페이스 {n}",
  "k8s.hint": "현재 컨텍스트의 파드·네임스페이스를 불러옵니다",
  "k8s.noPods": "파드 없음",

  "ssh.hosts": "SSH 호스트",
  "ssh.noConfig": "~/.ssh/config 없음",

  "task.none": "작업 없음",

  "snippets.none": "스니펫 없음",
  "snippets.runTitle": "실행: {cmd}",
  "snippets.labelPlaceholder": "라벨 (선택)",
  "snippets.commandPlaceholder": "명령…",

  "viewer.openFailed": "열기 실패: {error}",

  "rail.sessions": "세션",
  "rail.ports": "포트",
  "rail.ssh": "SSH",
  "rail.git": "Git",
  "rail.k8s": "K8s",
  "rail.docker": "Docker",
  "rail.task": "작업",
  "rail.snippets": "스니펫",
} as const;

export type MsgKey = keyof typeof KO;

const EN: Record<MsgKey, string> = {
  "common.refresh": "Refresh",
  "common.loading": "Loading…",
  "common.noActiveTerminal": "No active terminal",
  "common.open": "Open",
  "common.remove": "Remove",
  "common.delete": "Delete",
  "common.add": "Add",
  "common.browse": "Browse",
  "common.favorites": "Favourites",

  "titlebar.hideExplorer": "Hide explorer",
  "titlebar.showExplorer": "Show explorer",
  "titlebar.railFull": "Session rail: full",
  "titlebar.railMini": "Session rail: narrow",
  "titlebar.railHidden": "Session rail: hidden",
  "titlebar.railToggle": "{label} (click to switch)",
  "titlebar.minimize": "Minimise",
  "titlebar.maximize": "Maximise",
  "titlebar.close": "Close",

  "explorer.tab": "Explorer",
  "explorer.openTerminalHere": "Open terminal here",
  "explorer.openInViewer": "Open in viewer",
  "explorer.addFavorite": "Add to favourites",
  "explorer.removeFavorite": "Remove from favourites",
  "explorer.myComputer": "This PC",
  "explorer.drives": "Drives",
  "explorer.parentFolder": "Parent folder",

  "workspace.splitRow": "Split right",
  "workspace.splitColumn": "Split down",
  "workspace.closePane": "Close",
  "workspace.copyView": "Copy screen",
  "workspace.paste": "Paste",
  "workspace.selectAll": "Select all",
  "workspace.resetTerminal": "Reset terminal",
  "workspace.resetTerminalHint": "When moving the mouse types characters or the screen is stuck — clears the screen and resets terminal modes",
  "workspace.selectionHint": "Shift+drag to select part of the screen",
  "workspace.closeTab": "Close tab",
  "workspace.newTab": "New tab",
  "workspace.paneColor": "Pane colour",
  "workspace.colorDefault": "Default",
  "workspace.colorSwatch": "Colour {n}",

  "welcome.hint": "Open a folder to start a terminal, or pick one from favourites.",
  "welcome.openFolder": "Open folder…",
  "welcome.newTerminal": "New terminal",

  "sessions.header": "Sessions",
  "sessions.railMini": "Session rail (narrow)",
  "sessions.statusAwaitingPermission": "Awaiting permission",
  "sessions.statusAwaitingInput": "Waiting",
  "sessions.statusWorking": "Working",
  "sessions.statusIdle": "Idle",
  "sessions.statusDead": "Ended",
  "sessions.statuslineTitle": "Use a status line?",
  "sessions.statuslineBody":
    "Usage (context / 5-hour / 7-day) arrives through Claude Code's status line. You don't have one set up, so you can choose what Clowder draws there. Turning tracking off later restores the setting exactly as it was (absent).",
  "sessions.statuslineUsageOnly": "Collect usage only (empty status line)",
  "sessions.statuslineClowder": "Use Clowder's status line (folder · model · ctx · 5h)",
  "sessions.offTitle": "Session tracking is off",
  "sessions.offBody":
    "Install it to see running Claude Code sessions, their status, and usage (context / 5-hour / 7-day) here. It adds Claude Code hooks and reads usage from the status line. Your existing status line and settings are backed up and restored when you turn it off.",
  "sessions.brokenTitle": "Usage collection is disconnected",
  "sessions.brokenBody":
    "The session hooks are installed but the status line isn't wired to Clowder — sessions show up while usage (context / 5-hour / 7-day) stays empty. Reinstalling connects just the status line.",
  "sessions.installing": "Installing…",
  "sessions.install": "Install session tracking",
  "sessions.reinstall": "Reinstall",
  "sessions.none": "No sessions",
  "sessions.trackLoc": "Tracker at",
  "sessions.trackMissing": "Tracker missing",
  "sessions.openFolder": "Open folder",
  "sessions.uninstallTitle":
    "Removes only Clowder's hooks and status-line wrapper — your existing statusline and other settings are restored",
  "sessions.uninstall": "Turn off session tracking",
  "sessions.jumpToPane": "Jump to this session's pane",
  "sessions.runningHere": "Running in this pane",
  "sessions.dismiss": "Remove card",
  "sessions.dismissDead": "Clear ended sessions",
  "sessions.ownerUnknown": "The owning process can't be identified, so this card won't clear itself — remove it manually",
  "sessions.meterCtx": "Context {pct}% (top session)",
  "sessions.meterFiveHour": "5-hour {pct}%",
  "sessions.meterSevenDay": "7-day {pct}%",
  "sessions.fiveHour": "5h",
  "sessions.sevenDay": "7d",

  "settings.title": "Settings",
  "settings.groupAppearance": "Appearance",
  "settings.theme": "Theme",
  "settings.themeDark": "Dark",
  "settings.themeLight": "Light",
  "settings.accent": "Accent",
  "settings.accentAmber": "Amber",
  "settings.accentSage": "Sage",
  "settings.accentClay": "Clay",
  "settings.accentNeutral": "Neutral",
  "settings.uiScale": "UI size",
  "settings.language": "Language",
  "settings.languageAuto": "System",
  "settings.groupShell": "Shell",
  "settings.defaultShell": "Default shell",
  "settings.gitBashPath": "Git Bash path",
  "settings.autoDetect": "Auto-detect",
  "settings.groupTerminal": "Terminal",
  "settings.termThemeTitle":
    "The terminal palette is separate from the app theme. Most CLI colour schemes assume a dark background, so a dark terminal stays readable even in a light app.",
  "settings.termFollow": "Follow app",
  "settings.font": "Font",
  "settings.size": "Size",
  "settings.scrollback": "Scrollback",
  "settings.groupExplorer": "Explorer",
  "settings.startPath": "Start path",
  "settings.home": "Home",
  "settings.addFavorite": "+ Add",
  "settings.footer":
    "UI size, theme, accent and language apply immediately. Terminal font and size are separate settings and, like the shell and scrollback, take effect in terminals you open from now on.",

  "git.missing": "git not installed",
  "git.notRepo": "Not a repository",
  "git.clean": "Clean",
  "git.staged": "Staged",
  "git.unstaged": "Changed",
  "git.untracked": "Untracked",
  "git.conflicts": "Conflicts",

  "ports.title": "Listening ports",
  "ports.hideSystem": "Hide system ports",
  "ports.showSystem": "Show system ports",
  "ports.showSystemN": "Show system ports ({n})",
  "ports.system": "System",
  "ports.none": "No listening ports",
  "ports.noneUser": "No user ports",
  "ports.killTitle": "Kill PID {pid}",
  "ports.kill": "Kill",
  "ports.failed": "Failed",

  "docker.containers": "Containers",
  "docker.none": "No containers",
  "docker.start": "Start",
  "docker.stop": "Stop",

  "k8s.context": "Context",
  "k8s.cluster": "Cluster",
  "k8s.load": "Load",
  "k8s.namespace": "Namespace {n}",
  "k8s.hint": "Loads pods and namespaces for the current context",
  "k8s.noPods": "No pods",

  "ssh.hosts": "SSH hosts",
  "ssh.noConfig": "No ~/.ssh/config",

  "task.none": "No tasks",

  "snippets.none": "No snippets",
  "snippets.runTitle": "Run: {cmd}",
  "snippets.labelPlaceholder": "Label (optional)",
  "snippets.commandPlaceholder": "Command…",

  "viewer.openFailed": "Failed to open: {error}",

  "rail.sessions": "Sessions",
  "rail.ports": "Ports",
  "rail.ssh": "SSH",
  "rail.git": "Git",
  "rail.k8s": "K8s",
  "rail.docker": "Docker",
  "rail.task": "Tasks",
  "rail.snippets": "Snippets",
};

const MESSAGES: Record<Lang, Record<MsgKey, string>> = { ko: KO, en: EN };

export type TParams = Record<string, string | number>;

/** `{name}` placeholders are replaced positionally by key; unknown keys are left alone. */
export function translate(lang: Lang, key: MsgKey, params?: TParams): string {
  const raw = MESSAGES[lang][key] ?? MESSAGES.ko[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** `"auto"` resolves against the WebView locale, which follows the OS UI language. */
export function resolveLang(setting: LanguageSetting): Lang {
  if (setting === "ko" || setting === "en") return setting;
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav.toLowerCase().startsWith("ko") ? "ko" : "en";
}

/** Current resolved language. Its own store so `lib` never imports `features`. */
const useLangStore = create<{ lang: Lang }>(() => ({ lang: resolveLang("auto") }));

/** Called by the settings store on load and on every change. */
export function setLanguage(setting: LanguageSetting): void {
  const lang = resolveLang(setting);
  if (useLangStore.getState().lang !== lang) useLangStore.setState({ lang });
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

/** Non-reactive read, for code outside React (e.g. the terminal pool). */
export const currentLang = (): Lang => useLangStore.getState().lang;

/** The hook every component uses. Re-renders on language change. */
export function useT(): (key: MsgKey, params?: TParams) => string {
  const lang = useLangStore((s) => s.lang);
  return useMemo(() => (key: MsgKey, params?: TParams) => translate(lang, key, params), [lang]);
}
