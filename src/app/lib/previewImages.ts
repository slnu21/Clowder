// 로컬 이미지 src를 data URI로 인라인. asset 프로토콜(scope·CSP) 문제를 피해 Rust(read_file_base64)로
// 바이트를 직접 읽는다. 문서 폴더 기준 상대경로 해석. (md-reader lib/previewImages.ts 수확 — 무편집.)
import { readFileBase64 } from "./tauri";

export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : "";
}

function joinPath(dir: string, rel: string): string {
  // 절대 경로(드라이브/슬래시 시작)는 그대로, 상대 경로는 문서 폴더 기준.
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("/") || rel.startsWith("\\")) return rel;
  const clean = rel.replace(/^\.[\\/]/, "");
  return dir ? `${dir}/${clean}` : clean;
}

function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "bmp": return "image/bmp";
    case "avif": return "image/avif";
    case "ico": return "image/x-icon";
    default: return "application/octet-stream";
  }
}

// 해석된 절대경로 → data URI 캐시(세션).
const imgCache = new Map<string, string>();

/** 캐시 비우기(디스크의 이미지가 바뀌었을 때 등). */
export function clearImageCache(): void {
  imgCache.clear();
}

/** 로컬(상대/절대 파일) img src → data URI. 원격/data/blob은 그대로. 읽기 실패 시 원본 유지. */
export async function inlineImages(html: string, fileDir: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
      const abs = joinPath(fileDir, src);
      let uri = imgCache.get(abs);
      if (!uri) {
        try {
          const b64 = await readFileBase64(abs);
          uri = `data:${mimeOf(abs)};base64,${b64}`;
          imgCache.set(abs, uri);
        } catch {
          return; // 읽기 실패(경로 없음 등) → 원본 유지
        }
      }
      img.setAttribute("src", uri);
    }),
  );
  return doc.body.innerHTML;
}
