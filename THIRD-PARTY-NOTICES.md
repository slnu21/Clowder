# Third-Party Notices / 제3자 고지

Clowder is distributed under the MIT License (see `LICENSE`). It bundles and depends on the
third-party components listed below. **All are under permissive licenses (MIT, Apache-2.0, BSD, ISC,
MPL-2.0) that permit commercial use, redistribution, and sale**, provided their copyright and
permission notices are retained — which this file does. No component carries a copyleft (GPL/AGPL/
LGPL/SSPL) or non-commercial restriction.

Clowder는 MIT 라이선스로 배포됩니다(`LICENSE` 참조). 아래 제3자 구성요소를 번들·의존합니다. **모두
상업적 사용·재배포·판매를 허용하는 permissive 라이선스(MIT, Apache-2.0, BSD, ISC, MPL-2.0)**이며, 저작권·
허가 고지 유지를 조건으로 합니다(본 파일이 그 역할). copyleft(GPL/AGPL/LGPL/SSPL)나 비상업 제한 구성요소는
없습니다.

---

## Bundled native binaries / 번들 네이티브 바이너리

| Component | Source | License |
|---|---|---|
| `conpty.dll`, `OpenConsole.exe` (Microsoft.Windows.Console.ConPTY) | © Microsoft — [microsoft/terminal](https://github.com/microsoft/terminal) | MIT |

## Application runtime & Rust crates / 애플리케이션 런타임·Rust 크레이트

| Component | License |
|---|---|
| Tauri, WRY, TAO, `tauri-plugin-opener`, `tauri-plugin-dialog`, `tauri-plugin-single-instance` | MIT OR Apache-2.0 |
| `serde`, `serde_json` | MIT OR Apache-2.0 |
| `base64` | MIT OR Apache-2.0 |
| `portable-pty` (WezTerm) | MIT |
| `windows` (Microsoft windows-rs) | MIT OR Apache-2.0 |

## Frontend packages / 프론트엔드 패키지

| Component | License |
|---|---|
| React, React DOM | MIT |
| `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-opener` | MIT OR Apache-2.0 |
| `@xterm/xterm`, `@xterm/addon-fit` | MIT |
| `allotment` | MIT |
| `zustand` | MIT |
| `markdown-it` (+ anchor, container, footnote, task-lists, texmath, and other plugins) | MIT |
| `katex` | MIT |
| `mermaid` | MIT |
| `highlight.js` | BSD-3-Clause |
| `DOMPurify` | Apache-2.0 OR MPL-2.0 |
| Vite, `@vitejs/plugin-react`, TypeScript (build-time only) | MIT / Apache-2.0 |

## Runtime dependency (not bundled) / 런타임 의존성(번들 아님)

- **Microsoft Edge WebView2 Runtime** — provided by Microsoft under its own distribution terms and used
  through the operating system (bundled with Windows 11). Clowder does not redistribute it.
  Microsoft가 자체 배포 조건으로 제공하며 OS를 통해 사용됩니다(Windows 11 내장). Clowder는 재배포하지 않습니다.

---

The list above covers the principal components; their transitive dependencies are covered by compatible
permissive licenses. Full license texts are available in each package's own distribution and repository.

위 목록은 주요 구성요소이며, 그 이행적(transitive) 의존성도 호환되는 permissive 라이선스로 커버됩니다. 전체
라이선스 원문은 각 패키지의 배포본·저장소에서 확인할 수 있습니다.
