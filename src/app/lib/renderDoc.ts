// 렌더 문서 빌더 — 미리보기 iframe이 쓴다. deck 토큰 + PREVIEW_CSS(코드 하이라이트·수식(MathML)·
// mermaid 스타일 전부 인라인)로 자기완결 HTML 문서 문자열을 만든다.
// (md-reader lib/renderDoc.ts 수확 — PREVIEW_CSS는 색 참조만 앱 토큰에 맞춰 손봤고, buildDoc은 deck
//  토큰 직접 주입으로 적응. md-reader의 테마 시스템·번들 폰트 모듈은 가져오지 않는다 — deck은 앱 토큰을
//  그대로 읽어 쓰고 폰트는 시스템 폴백.)

// iframe/문서 내부(리더) 스타일. 색은 주입된 토큰 사용, 폰트는 --read-font(주입) + 시스템 폴백.
export const PREVIEW_CSS = `
*{box-sizing:border-box}
html,body{margin:0}
body{padding:14px 14px 40px;background:color-mix(in srgb,var(--bg) 92%,#000);color:var(--fg);
  font-family:var(--read-font,"Palatino Linotype","Book Antiqua",Georgia,"Times New Roman",serif);
  font-size:var(--reader-font-size,16px);line-height:1.75;-webkit-font-smoothing:antialiased}
/* 조판 시트: 페인 폭을 따라 넓어지는 카드(얇은 매트 여백) */
.md{margin:0;background:var(--bg);border:1px solid var(--border);
  border-radius:10px;padding:32px 44px 44px;
  box-shadow:0 1px 2px rgba(0,0,0,.05),0 10px 30px rgba(0,0,0,.05)}
h1,h2,h3,h4,h5{font-weight:600;line-height:1.25;margin:1.6em 0 .6em}
h1{font-size:1.95em;margin-top:0;letter-spacing:-.01em}
h2{font-size:1.45em;border-bottom:1px solid var(--border);padding-bottom:.25em}
h3{font-size:1.2em}
p{margin:0 0 1em}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
ul,ol{padding-left:1.5em;margin:0 0 1em}
li{margin:.25em 0}
blockquote{margin:0 0 1em;padding:.2em 0 .2em 1em;border-left:3px solid var(--accent);
  color:color-mix(in srgb,var(--fg) 62%,var(--bg));font-style:italic}
code{font-family:"Cascadia Code","Cascadia Mono",ui-monospace,Consolas,monospace;
  font-size:.86em;background:color-mix(in srgb,var(--accent) 12%,var(--bg));
  color:color-mix(in srgb,var(--accent) 55%,var(--fg));padding:.12em .4em;border-radius:5px}
pre{background:color-mix(in srgb,var(--fg) 5%,var(--bg));border:1px solid var(--border);
  border-radius:8px;padding:14px 16px;overflow:auto;margin:0 0 1em}
pre code{background:none;color:inherit;padding:0;font-size:.85em}
table{border-collapse:collapse;width:100%;margin:0 0 1em;
  font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;font-size:.95em}
th,td{border:1px solid var(--border);padding:7px 11px;text-align:left}
thead th{background:var(--surface)}
img{max-width:100%;height:auto;border-radius:6px}
hr{border:none;border-top:1px solid var(--border);margin:1.6em 0}
h1:first-child,h2:first-child,h3:first-child{margin-top:0}
.task-list-item{list-style:none}
.task-list-item-checkbox{margin:0 .5em 0 -1.4em}
.footnotes{font-size:.9em;color:color-mix(in srgb,var(--fg) 78%,var(--bg));border-top:1px solid var(--border);margin-top:2.4em;padding-top:.4em}
.footnotes ol{padding-left:1.4em}
.footnote-ref a,.footnote-backref{text-decoration:none;color:var(--accent)}
mark{background:color-mix(in srgb,var(--accent) 22%,var(--bg));color:inherit;padding:.05em .2em;border-radius:3px}
ins{text-decoration:underline}
sub,sup{font-size:.75em;line-height:0}
abbr[title]{text-decoration:underline dotted;cursor:help}
dl dt{font-weight:600;margin-top:.7em}
dl dd{margin:0 0 .4em 1.3em}
.callout{border-left:4px solid var(--accent);border-radius:0 6px 6px 0;padding:.4em 1em;margin:1em 0;background:color-mix(in srgb,var(--accent) 8%,var(--bg))}
.callout>:first-child{margin-top:0}
.callout>:last-child{margin-bottom:0}
.callout.warning{border-color:var(--warn);background:color-mix(in srgb,var(--warn) 8%,var(--bg))}
.callout.tip{border-color:var(--ok);background:color-mix(in srgb,var(--ok) 8%,var(--bg))}
.hljs{background:transparent;color:inherit}
.hljs-comment,.hljs-quote{color:color-mix(in srgb,var(--fg) 45%,var(--bg));font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-section,.hljs-doctag,.hljs-type,.hljs-name,.hljs-strong{color:color-mix(in srgb,var(--accent) 80%,var(--fg));font-weight:600}
.hljs-string,.hljs-title,.hljs-attr,.hljs-attribute,.hljs-symbol,.hljs-bullet,.hljs-addition,.hljs-template-tag,.hljs-template-variable{color:color-mix(in srgb,var(--accent) 52%,var(--fg))}
.hljs-number,.hljs-meta,.hljs-built_in,.hljs-variable,.hljs-params,.hljs-selector-id,.hljs-selector-class{color:color-mix(in srgb,var(--fg) 82%,var(--bg))}
.hljs-deletion{color:var(--danger)}
.hljs-emphasis{font-style:italic}
math{font-size:1.02em}
math[display="block"],eqn{display:block;margin:1em 0;text-align:center;overflow-x:auto}
eq{padding:0 .1em}
.mermaid-rendered{display:flex;justify-content:center;margin:1em 0}
.mermaid-rendered svg{max-width:100%;height:auto}
.mermaid-error{color:var(--danger)}
`;

const READ_FONT =
  `--read-font:"Palatino Linotype","Book Antiqua",Georgia,"Times New Roman",serif;--reader-font-size:15px;`;

/**
 * PREVIEW_CSS가 쓰는 토큰을 앱의 실제 커스텀 프로퍼티에서 읽어 문자열로 만든다.
 *
 * 미리보기는 **자체 document를 가진 iframe**이라 앱의 `:root` 토큰이 캐스케이드로 넘어가지 않는다 —
 * 여기서 값을 해석해 생성 문서의 `<style>`에 박아 넣어야 리더가 테마·액센트를 따라간다.
 * (이전엔 다크 5색이 하드코딩이라 라이트 모드에서 뷰어만 검게 남았고, 그 값들은 리디자인 이전
 *  파란 팔레트 잔재였다 — 액센트 설정도 반영되지 않았다.)
 *
 * 폴백이 필요한 이유는 `xtermTheme()`과 같다: 스타일시트가 아직 적용되기 전 `getComputedStyle`은
 * 빈 문자열을 돌려주고, 빈 토큰은 스타일 없는 문서를 렌더한다.
 */
function docTokens(light: boolean): string {
  const rs = getComputedStyle(document.documentElement);
  const v = (name: string, dark: string, lit: string) =>
    rs.getPropertyValue(name).trim() || (light ? lit : dark);
  return (
    // 조판 시트는 한 단계 들린 면(--bg-raised) — 다크·라이트 모두 매트 여백 위의 종이로 읽힌다.
    `--bg:${v("--bg-raised", "#1f1e1b", "#f4f2ed")};` +
    `--fg:${v("--text-1", "#e8e6e1", "#262420")};` +
    `--border:${v("--line-1", "#302e2a", "#dad7cf")};` +
    `--accent:${v("--accent", "#c8a15c", "#9c6f2e")};` +
    `--surface:${v("--bg-overlay", "#282722", "#ffffff")};` +
    // 시맨틱 훅: 콜아웃·삭제줄·mermaid 오류가 앱의 같은 색을 쓴다.
    `--ok:${v("--ok", "#8faa6e", "#5f7d3f")};` +
    `--warn:${v("--warn", "#d99a4e", "#a86e28")};` +
    `--danger:${v("--danger", "#cf6b6b", "#b04a4a")};`
  );
}

/** 문서 테마 = 앱 루트의 `data-theme`(설정 스토어가 쓴다). lib은 feature 스토어를 import하지 않는다. */
export const isLightDoc = (): boolean =>
  document.documentElement.getAttribute("data-theme") === "light";

/** 본문 HTML을 자기완결 HTML 문서 문자열로 감싼다(deck 토큰·PREVIEW_CSS 인라인). extraCss는 뒤에 붙는다. */
export function buildDoc(bodyHtml: string, extraCss = ""): string {
  const light = isLightDoc();
  const scheme = light ? "light" : "dark";
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${scheme}">` +
    // color-scheme을 CSS로도 선언해야 iframe 스크롤바가 테마를 따라간다.
    `<style>:root{color-scheme:${scheme};${docTokens(light)}${READ_FONT}}${PREVIEW_CSS}${extraCss}</style></head>` +
    `<body><div class="md">${bodyHtml}</div></body></html>`
  );
}
