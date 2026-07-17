# conpty (vendored)

`conpty.dll` + `OpenConsole.exe` from the **`Microsoft.Windows.Console.ConPTY`** NuGet package
(MIT · Microsoft · https://github.com/microsoft/terminal).

| | |
|---|---|
| package version | `1.24.260710001` |
| file version | `1.24.2607.10001` (both files — **must match**) |
| source | `runtimes/win-x64/native/conpty.dll` · `build/native/runtimes/x64/OpenConsole.exe` |

## 왜 vendoring하나

**OS 내장 ConPTY는 버퍼가 어긋난다** — `microsoft/terminal#15976`("[megathread] ConPTY buffer gets
out-of-sync")이 2023-09부터 열려 있고 메인테이너가 *"a Hard problem"*이라고 인정했다. VS Code ·
Alacritty · Zed · WezTerm · Warp 등 9개 이상의 주요 터미널이 전부 OS 것을 불신하고 사이드로드한다.

`portable-pty`가 이 패턴을 내장하고 있다 (`src/win/psuedocon.rs`):

```rust
// We prefer to use a sideloaded conpty.dll and openconsole.exe host deployed
// alongside the application.
if let Ok(sideloaded) = ConPtyFuncs::open(Path::new("conpty.dll")) {
    sideloaded
} else {
    kernel          // ← 조용한 폴백
}
```

## ★ 폴백이 조용하다

경로에 디렉터리가 없으므로 Windows DLL 검색 순서상 **exe 디렉터리**에서 찾고, **없으면 말없이
`kernel32`로 떨어진다.** 앱은 멀쩡히 돌고 버그투성이 OS ConPTY를 쓴다 — **눈으로 구별 불가**.
게다가 `CONPTY`는 private `lazy_static`이라 portable-pty에게 어느 쪽을 골랐는지 물어볼 API가 없다.

그래서 **`--selftest`가 독립적으로 단언한다**: 두 파일이 exe 옆에 있는지, `conpty.dll`을 직접
로드했을 때 **모듈 경로가 exe 디렉터리인지**(= 사이드로드가 이겼는지). 단언을 추가할 때마다
`conpty.dll`을 잠시 치워 `RESULT=FAIL`이 실제로 나는지 증명할 것 — 증명 안 된 게이트는 장식이다.

## 배치

- **dev**: `build.rs`가 `target/<profile>/`로 복사한다. `tauri dev`가 거기서 실행되므로, 빠뜨리면
  **개발 내내 폴백 경로로 테스트하게 된다.**
- **release**: `tauri.conf.json`의 `bundle.resources`가 exe 옆에 둔다.

## 갱신

**두 파일을 반드시 함께** 올린다(wezterm#7774 — 버전이 어긋나면 깨진다). 위 표의 버전을 같이 갱신할 것.

```bash
V=<새 버전>
curl -sLO "https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty/$V/microsoft.windows.console.conpty.$V.nupkg"
```
