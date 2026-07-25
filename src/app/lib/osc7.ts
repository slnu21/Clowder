/**
 * Turn an OSC 7 `file://` URI (what a shell emits before each prompt) into a Windows path, or
 * `undefined` when it isn't a drive path we can use. Handles both forms deck's shells emit:
 *   - Git Bash / MSYS: `file:///c/Users/한글`  → `C:\Users\한글`
 *   - PowerShell:      `file:///C:/Users/한글` → `C:\Users\한글`
 *
 * No percent-decoding: the shells emit the path raw (UTF-8), so Korean arrives intact through xterm's
 * decoder and a literal `%` in a folder name stays literal. Anything that isn't a `DRIVE:` path — a
 * PowerShell registry/cert location, a UNC path, junk — returns `undefined` and is ignored.
 */
export function osc7ToPath(data: string): string | undefined {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data.trim());
  if (!m) return undefined;
  let p = m[1];
  if (/^\/[A-Za-z]:/.test(p)) {
    p = p.slice(1); // /C:/Users → C:/Users (PowerShell form)
  } else {
    const msys = /^\/([A-Za-z])\/(.*)$/.exec(p); // /c/Users → C:/Users (MSYS form)
    if (msys) p = `${msys[1].toUpperCase()}:/${msys[2]}`;
    else if (/^\/[A-Za-z]$/.test(p)) p = `${p[1].toUpperCase()}:/`; // /c → C:/
    else return undefined;
  }
  p = p.replace(/\//g, "\\").replace(/\\+$/, ""); // forward → back slashes, drop trailing
  if (!/^[A-Za-z]:/.test(p)) return undefined;
  return p.length === 2 ? p + "\\" : p; // "C:" → "C:\"
}
