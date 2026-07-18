// markdown-it 설정. GFM 확장 + 인라인/블록 플러그인 + 코드 하이라이트(highlight.js).
// 수식(KaTeX)은 별도 단계에서 추가한다. 렌더 결과는 반드시 lib/sanitize.ts 로 정화 후
// sandbox iframe 에 주입한다. 하이라이트는 워커/메인 어디서든 DOM 없이 정적 렌더된다.
// (md-reader lib/markdown.ts 수확 — 무편집.)
import MarkdownIt from "markdown-it";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import mark from "markdown-it-mark";
import ins from "markdown-it-ins";
import abbr from "markdown-it-abbr";
import deflist from "markdown-it-deflist";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import container from "markdown-it-container";
import multimdTable from "markdown-it-multimd-table";
import frontMatter from "markdown-it-front-matter";
import anchor from "markdown-it-anchor";
import texmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import cssLang from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import markdownLang from "highlight.js/lib/languages/markdown";
import diff from "highlight.js/lib/languages/diff";
import { slugify } from "./slugify";

// 코드블록 언어(지연 로드 대신 큐레이션 세트 번들 — 번들 크기 절제). 별칭(ts/js/sh/html…)은 각 언어가 등록.
const LANGS: Record<string, LanguageFn> = {
  typescript, javascript, python, rust, bash, json, xml, css: cssLang,
  go, java, c, cpp, yaml, sql, markdown: markdownLang, diff,
};
let registered = false;
function registerLanguages(): void {
  if (registered) return;
  for (const [name, fn] of Object.entries(LANGS)) hljs.registerLanguage(name, fn);
  registered = true;
}

const CALLOUTS = ["note", "warning", "tip"] as const;

/** mermaid 소스 → base64(UTF-8). data-src 속성에 안전하게 싣기 위함(lib/mermaid.ts decodeMermaidSrc 와 짝).
 *  원문의 `-->`·`->>`·`<|--` 등 `<`/`>` 포함 시 DOMPurify의 mXSS 방지 스크러빙이 data-src를 통째로
 *  제거해 다이어그램이 렌더되지 않는 문제가 있었다 → base64([A-Za-z0-9+/=])는 절대 스크럽되지 않는다. */
function encodeMermaidSrc(src: string): string {
  const bytes = new TextEncoder().encode(src);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function createMarkdown(): MarkdownIt {
  registerLanguages();

  const md = new MarkdownIt({
    html: true, // 원시 HTML 허용 — 렌더 결과는 반드시 DOMPurify로 정화한다.
    linkify: true,
    typographer: true,
    breaks: false,
  });

  // 코드 하이라이트(hljs). mermaid 언어는 하이라이트하지 않고 메인스레드 렌더용 placeholder로 통과.
  md.set({
    highlight: (str: string, lang: string): string => {
      if (lang === "mermaid") {
        // 소스는 base64로 실어 나른다(속성값 안전) — DOMPurify가 `-->` 등 포함 data-src를 지우는 문제 회피.
        return `<pre class="mermaid" data-src="${encodeMermaidSrc(str)}"></pre>`;
      }
      const language = lang && hljs.getLanguage(lang) ? lang : "";
      const code = language
        ? hljs.highlight(str, { language, ignoreIllegals: true }).value
        : md.utils.escapeHtml(str);
      return `<pre class="hljs"><code class="hljs${language ? " language-" + language : ""}">${code}</code></pre>`;
    },
  });

  md.use(frontMatter, () => {}) // YAML front-matter는 소비만(렌더하지 않음)
    .use(sub)
    .use(sup)
    .use(mark)
    .use(ins)
    .use(abbr)
    .use(deflist)
    .use(footnote)
    .use(taskLists, { label: true }) // 체크박스는 disabled(표시 전용)
    .use(multimdTable, { multiline: true, rowspan: true, headerless: true });

  // 콜아웃(admonition) 컨테이너 — ::: note / warning / tip
  for (const name of CALLOUTS) {
    md.use(container, name, {
      render(tokens: Array<{ nesting: number }>, idx: number) {
        return tokens[idx].nesting === 1 ? `<div class="callout ${name}">\n` : "</div>\n";
      },
    });
  }

  // 헤딩 id(아웃라인/TOC 앵커의 진실원본) — 유니코드 보존 slugify 공유
  md.use(anchor, { slugify, permalink: false });

  // 수식(KaTeX) — MathML 출력이라 폰트 번들·CSP 변경 불필요, sandbox 유지
  md.use(texmath, {
    engine: katex,
    delimiters: "dollars",
    katexOptions: { output: "mathml", throwOnError: false },
  });

  // 소스라인 스탬프 — 블록 여는 토큰에 data-line(0-based 시작줄) 부착(DOMPurify가 data-* 보존).
  md.core.ruler.push("source_line", (state) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting >= 0 && token.type !== "inline") {
        token.attrSet("data-line", String(token.map[0]));
      }
    }
  });

  return md;
}

export interface TocItem {
  level: number;
  text: string;
  id: string;
}

/** md.parse 토큰에서 헤딩 아웃라인 추출. anchor 코어 룰이 부여한 실제 id(dedup 포함)를 사용. */
export function extractToc(md: MarkdownIt, src: string): TocItem[] {
  const tokens = md.parse(src, {});
  const toc: TocItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== "heading_open") continue;
    const id = tok.attrGet("id");
    if (!id) continue;
    toc.push({ level: Number(tok.tag.slice(1)), text: tokens[i + 1]?.content ?? "", id });
  }
  return toc;
}
