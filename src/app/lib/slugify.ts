// 헤딩 id 슬러그 — markdown-it-anchor 플러그인과 아웃라인/TOC 추출이 공유한다.
// 기본 slugify는 non-ASCII(한글 등)를 버리므로, 유니코드 문자를 보존한다.
// (md-reader lib/slugify.ts 수확 — 무편집.)
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
