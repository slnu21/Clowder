<div align="center">

# Clowder 개인정보 처리방침 / Privacy Policy

**시행일 / Effective date: 2026-07-19**

</div>

## 한국어

**Clowder는 오프라인·로컬 전용 데스크톱 앱입니다.** 개인정보를 수집·전송·판매하지 않으며, 원격 서버로
보내는 어떠한 데이터도 없습니다. 계정, 로그인, 광고, 분석(analytics), 원격 오류 보고(telemetry)가 없습니다.
모든 처리는 사용자의 PC 안에서만 이루어집니다.

### 앱이 로컬에서 다루는 것 (기기 밖으로 나가지 않음)

- **파일 탐색기**: 사용자가 탐색하는 폴더·파일의 이름과 내용을 화면에 표시하기 위해 읽습니다. 저장·전송하지
  않습니다.
- **터미널**: 사용자가 실행한 셸(예: PowerShell·bash)과 입력/출력을 중계합니다. 별도로 기록하거나 전송하지
  않습니다.
- **세션 추적(선택 기능, 설치 시에만)**: 설치를 선택하면, Claude Code 훅이 로컬에 기록하는 세션 상태·사용량
  스풀 파일을 읽어 현황을 보여줍니다. 이를 위해 Claude Code 설정 파일(`~/.claude/settings.json`)에 Clowder
  훅을 추가합니다 — **변경 전 항상 백업을 만들며, "세션 추적 끄기"로 원본을 그대로 복원**합니다. 이 데이터는
  전부 로컬에 머뭅니다.
- **문서 뷰어**: 로컬 Markdown/HTML 문서를 렌더링합니다(외부 자산 로드는 콘텐츠 보안 정책으로 차단).
- **앱 설정**: 테마·셸 등 사용자의 설정을 로컬에 저장합니다.

### 데이터 위치

| 데이터 | 위치 |
|---|---|
| 앱 설정 | `%APPDATA%\deck` |
| 세션 추적 스풀(설치 시) | `%LOCALAPPDATA%\Clowder` |
| Claude Code 설정 백업(세션 추적 설치 시) | `%LOCALAPPDATA%\Clowder\settings-backups`, `~/.claude/settings.json.bak-clowder` |

세션 추적을 끄면 Clowder가 추가한 훅과 스풀·복사본은 제거되고, 사용자의 Claude Code 설정은 원래대로
복원됩니다.

### 제3자

- **Microsoft Edge WebView2**(Windows 구성요소)를 화면 렌더링에 사용합니다. Clowder는 이를 통해 데이터를
  외부로 전송하지 않습니다. WebView2 자체는 Microsoft의 조건을 따릅니다.

### 아동

본 앱은 아동을 대상으로 하지 않으며, 아동으로부터 개인정보를 수집하지 않습니다.

### 변경

방침이 바뀌면 이 문서와 시행일을 갱신합니다.

### 문의

- GitHub: [github.com/slnu21](https://github.com/slnu21) (Issues)

---

## English

**Clowder is an offline, local-only desktop app.** It does not collect, transmit, or sell personal
information, and it sends no data to any remote server. There are no accounts, logins, ads, analytics,
or telemetry. All processing happens entirely on your own PC.

### What the app handles locally (never leaves your device)

- **File explorer**: reads the names and contents of the folders and files you browse, solely to display
  them. Nothing is stored or transmitted.
- **Terminals**: relays input/output between you and the shell you launch (e.g. PowerShell, bash). It is
  not separately recorded or sent anywhere.
- **Session tracking (optional, only if you install it)**: if you choose to install it, Clowder reads the
  session-status and usage spool files that Claude Code's hooks write locally, to display live status. To
  do so it adds Clowder hooks to your Claude Code settings (`~/.claude/settings.json`) — **a backup is
  always made before any change, and "turn off session tracking" restores your original exactly**. This
  data stays entirely local.
- **Document viewer**: renders local Markdown/HTML documents (external asset loading is blocked by the
  content-security policy).
- **App settings**: stores your preferences (theme, shell, etc.) locally.

### Data locations

| Data | Location |
|---|---|
| App settings | `%APPDATA%\deck` |
| Session-tracking spool (if installed) | `%LOCALAPPDATA%\Clowder` |
| Claude Code settings backups (if session tracking installed) | `%LOCALAPPDATA%\Clowder\settings-backups`, `~/.claude/settings.json.bak-clowder` |

Turning off session tracking removes the hooks, spool, and copies Clowder added, and restores your Claude
Code settings to their original state.

### Third parties

- **Microsoft Edge WebView2** (a Windows component) is used to render the UI. Clowder does not send any
  data externally through it. WebView2 itself is governed by Microsoft's terms.

### Children

This app is not directed to children and does not knowingly collect personal information from children.

### Changes

If this policy changes, this document and its effective date will be updated.

### Contact

- GitHub: [github.com/slnu21](https://github.com/slnu21) (Issues)
