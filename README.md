<div align="center">

# Clowder

**여러 Claude Code 세션을 한 화면에서 다루는 터미널 워크스페이스**
*A terminal workspace for running parallel Claude Code sessions on one screen*

Windows · 오프라인 / 로컬 전용 · [MIT](LICENSE)

<img src="assets/screenshot.png" alt="Clowder — 파일 탐색기, 터미널, 실행 중인 Claude Code 세션 레일을 한 창에 / file explorer, terminal, and a live Claude Code session rail in one window" width="900">

</div>

## 왜

VS Code가 대부분을 덮지만 두 가지가 막힌다: **탐색기가 연 폴더(workspace)에 종속**돼 전체 파일시스템을 자유롭게 뒤질 수 없고, 세션·서브에이전트 트리를 붙일 수 없다. Windows Terminal의 pane은 터미널만 담는다.

Clowder는 **여러 Claude Code 세션을 병렬로** 돌리며 — 터미널에서 git·빌드를 하고, 산출물을 문서 뷰어로 확인하고, 전체 파일을 탐색하는 걸 **정돈된 한 창**에 모은다. 그리고 실행 중인 세션의 상태·사용량을 우측 레일에 상시 보여준다.

## 주요 기능

- **탭 + 타일링 터미널** — 폴더에서 바로 터미널 열기, 페인 분할, PowerShell / bash. 터미널은 keep-alive 풀이라 탭을 오가도 살아있다.
- **전체 파일 탐색기** — 연 폴더에 종속되지 않는다. 단일 폴더 네비게이터(`..` 상위 이동) + 활성 터미널 cwd 기준 workspace 트리.
- **세션 레일**(선택 설치) — 실행 중인 Claude Code 세션 상태(승인 대기 · 내 차례 · 동작 중 · 유휴), 서브에이전트, 컨텍스트·5시간/7일 사용량. 우측 레일 버튼으로 설치하며, 기존 Claude Code 설정은 백업 후 언제든 복원한다.
- **문서 뷰어** — 로컬 Markdown / HTML(수식·다이어그램 포함) 렌더링.
- **디자인** — 딥다크 / 라이트 테마 + 액센트, 커스텀 제목표시줄.

## 시작하기

1. [Releases](https://github.com/slnu21/Clowder/releases)에서 설치 파일을 받는다 — `Clowder_*_x64-setup.exe`(NSIS, 권장) 또는 `Clowder_*_x64_en-US.msi`.
2. **요구사항**: Windows 10 / 11 (x64), WebView2 런타임(Windows 11 내장).
3. **오프라인 / 로컬 전용** — 네트워크 전송·원격 서버 없음. 설정은 `%APPDATA%\deck`, 세션 추적 스풀(설치 시)은 `%LOCALAPPDATA%\Clowder`에 로컬 저장. 자세히는 [PRIVACY.md](PRIVACY.md).

> 세션 추적은 첫 실행 시 강제되지 않는다. 우측 레일 버튼으로 설치하면 Claude Code 훅이 안전하게 추가되고(설정 백업), "세션 추적 끄기"로 원래대로 복원된다.

## 개발

Tauri v2 (Rust 셸) + React + TypeScript + Vite. 프론트엔드 소스는 Tauri 기본 `src/`가 아니라 **`src/app/`**에 있다.

```bash
cd src
npm install            # 최초 1회
npm run tauri dev      # 개발 실행
npm run tauri build    # 릴리스 빌드 (MSI / NSIS)
```

MSIX 패키징(Microsoft Store)은 [packaging/README.md](packaging/README.md) 참고.

## 라이선스

[MIT](LICENSE) © 2026 slnu21 — 상업적 사용·재배포 허용. 번들·의존 구성요소 고지는 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

<div align="center">

## English

</div>

## Why

VS Code covers most of it, but two things are blocked: **its explorer is tied to the open workspace folder** (you can't freely browse the whole filesystem), and you can't attach a session / subagent tree. Windows Terminal panes only hold terminals.

Clowder runs **multiple Claude Code sessions in parallel** — do git and builds in the terminals, check the output in a document viewer, and browse the whole filesystem, all in **one organized window** — with a live rail showing each session's status and usage.

## Features

- **Tabbed + tiling terminals** — open a terminal straight from a folder, split panes, PowerShell / bash. Terminals live in a keep-alive pool, surviving tab switches.
- **Full file explorer** — not bound to the open folder: a single-folder navigator (with `..` up-navigation) plus a workspace tree scoped to the active terminal's cwd.
- **Session rail** (optional) — live Claude Code session status (awaiting permission · my turn · working · idle), subagents, and context / 5h / 7d usage. Install it from the rail button; your Claude Code settings are backed up and fully restorable.
- **Document viewer** — renders local Markdown / HTML with math and diagrams.
- **Design** — deep-dark / light themes with an accent, and a custom title bar.

## Getting started

1. Grab an installer from [Releases](https://github.com/slnu21/Clowder/releases) — `Clowder_*_x64-setup.exe` (NSIS, recommended) or `Clowder_*_x64_en-US.msi`.
2. **Requirements**: Windows 10 / 11 (x64), WebView2 runtime (built into Windows 11).
3. **Offline & local-only** — no network transmission, no remote servers. Settings live in `%APPDATA%\deck`; the session-tracking spool (if installed) in `%LOCALAPPDATA%\Clowder`. See [PRIVACY.md](PRIVACY.md).

> Session tracking is never forced on first run. Install it from the rail button — Claude Code hooks are added safely (settings backed up), and "turn off session tracking" restores everything.

## Development

Tauri v2 (Rust shell) + React + TypeScript + Vite. The frontend source lives in **`src/app/`**, not Tauri's default `src/`.

```bash
cd src
npm install            # first time
npm run tauri dev      # run in dev
npm run tauri build    # release build (MSI / NSIS)
```

For MSIX packaging (Microsoft Store), see [packaging/README.md](packaging/README.md).

## License

[MIT](LICENSE) © 2026 slnu21 — commercial use and redistribution permitted. Bundled / dependency notices in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
