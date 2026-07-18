// DOMPurify 정화 설정 중앙화. 미리보기는 sandbox iframe에 주입되어 스크립트가 원천 차단되지만,
// 이중 방어로 정화한다. (md-reader lib/sanitize.ts 수확 — 무편집.)
import DOMPurify from "dompurify";

// KaTeX MathML 출력에서 DOMPurify 기본 허용목록이 빠뜨리는 태그(semantics/annotation 등)를 보강.
const MATHML_TAGS = [
  "math", "semantics", "annotation", "annotation-xml", "mrow", "mi", "mo", "mn",
  "ms", "mtext", "mspace", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
  "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mpadded", "mphantom",
  "menclose", "mstyle", "merror", "mglyph",
];

const CONFIG = {
  // eq/eqn = markdown-it-texmath 래퍼 요소
  ADD_TAGS: [...MATHML_TAGS, "eq", "eqn"],
  ADD_ATTR: [
    // MathML 속성
    "encoding", "display", "mathvariant", "displaystyle", "scriptlevel",
    "stretchy", "accent", "accentunder", "columnalign", "rowspacing", "columnspacing",
    "open", "close", "separators", "fence", "lspace", "rspace", "width", "linethickness",
    // task-list 체크박스
    "checked", "disabled", "type",
    // 스크롤 동기화 소스라인. DOMPurify 기본이 data-* 를 허용하지만 명시적으로 보존.
    "data-line",
  ],
};

/** 미리보기 HTML 정화(마크다운 렌더 결과). sandbox iframe 주입 전 이중 방어. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG) as unknown as string;
}

/** mermaid 등에서 생성된 SVG 정화. foreignObject + 내부 표시용 HTML 라벨 허용.
 *  htmlLabels를 끄면 대개 foreignObject 자체가 안 나오지만, 일부 다이어그램(class/state 등)이
 *  foreignObject를 강제할 때 라벨 글자가 사라지지 않도록 양성 HTML 태그를 허용한다(no-scripts 샌드박스라 안전). */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    // svg + html 프로파일을 **함께** → <foreignObject> 안 HTML 라벨(div/span/텍스트) 태그를 허용.
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ["foreignObject"],
    ADD_ATTR: ["style", "class", "xmlns"],
    // 핵심: <foreignObject> 안의 HTML이 네임스페이스 검사에 걸려 서브트리째 제거되는 것을 막는다.
    HTML_INTEGRATION_POINTS: { foreignobject: true, "annotation-xml": true },
  }) as unknown as string;
}

/** 완결 HTML 문서(외부 .html 파일) 정화 — 스크립트·이벤트 핸들러 제거, 문서 구조는 보존. */
export function sanitizeDocument(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    ADD_ATTR: ["target"],
  }) as unknown as string;
}
