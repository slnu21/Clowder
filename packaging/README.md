# Clowder 릴리스 · 패키징

**MSIX가 주 배포(Microsoft Store)**, NSIS 인스톨러는 사이드 채널(GitHub 릴리스).

> 표시명 = `Clowder` · 내부 exe = `clowder.exe` · 산출물 = `Clowder_<ver>_x64.msix`.

## 전제
- `npx tauri build`로 릴리스 exe가 먼저 빌드돼 있어야 함. deck는 target dir를 `D:\build\deck`로 뺐으므로
  릴리스 exe는 **`D:\build\deck\release\clowder.exe`**(+ `conpty.dll`·`OpenConsole.exe`).
  `pack-msix.ps1`이 `.cargo\config.toml`의 `target-dir`을 읽어 자동 해석 — 다르면 `-ReleaseDir`로 지정.
- Windows SDK (makeappx.exe / signtool.exe).
- 산출물은 `packaging/build/`에 생성(gitignore).

## 1) MSIX — 주 배포 (Microsoft Store)
```powershell
# Store 업로드용(미서명 — Microsoft가 재서명):
pwsh packaging/pack-msix.ps1
#   -> packaging/build/Clowder_0.1.0_x64.msix

# 로컬 설치·테스트용(자체 서명):
pwsh packaging/pack-msix.ps1 -Sign
#   -> 안내되는 두 줄을 관리자 PowerShell에서 실행하면 설치됨.
```
- Tauri는 MSI/NSIS만 내므로 **빌드된 exe를 MSIX로 래핑**(makeappx). 매니페스트: `msix/AppxManifest.template.xml`
  (DisplayName=`Clowder`, full-trust `runFullTrust`). full-trust라야 전체 탐색기(`std::fs` 임의경로)와
  셸/ConPTY 실행이 유지된다(AppContainer면 차단).
- **conpty.dll·OpenConsole.exe가 패키지에 포함**된다(스크립트가 복사) — 빠지면 터미널이 버그 많은 OS ConPTY로
  조용히 폴백한다.
- **WebView2**: 별도 `PackageDependency`를 선언하지 않고 Windows 11 내장 런타임에 의존(md-reader 선례와 동일).
  구형 OS 지원이 필요해지면 매니페스트에 WebView2 `PackageDependency` 추가 검토.
- **Store 제출 시** Partner Center에서 앱 이름 예약 후, 받은 값으로:
  ```powershell
  pwsh packaging/pack-msix.ps1 `
    -IdentityName "<Partner Center Identity Name>" `
    -Publisher   "CN=<Partner Center Publisher ID>" `
    -PublisherDisplay "<게시자 표시 이름>"
  ```
  생성된 미서명 `.msix`를 업로드(재서명은 Microsoft가 처리 → 코드서명 인증서 불필요).
- **개인정보 처리방침**: Store는 공개 URL을 요구한다. 루트 `PRIVACY.md`를 공개 위치(예: SlnU-blog)에 호스팅하고
  그 URL을 제출 폼에 기입.

## 2) NSIS 인스톨러 (GitHub 릴리스 사이드 채널)
```powershell
cd src
npx tauri build   # 기본 번들에 NSIS/MSI 포함
#   -> D:\build\deck\release\bundle\nsis\Clowder_0.1.0_x64-setup.exe
#   -> D:\build\deck\release\bundle\msi\Clowder_0.1.0_x64_en-US.msi
```

## 릴리스 전 체크
- [x] **CSP 하드닝** — `app.security.csp` 적용(원격 차단, `script-src 'self'`).
- [x] **LICENSE / THIRD-PARTY-NOTICES / PRIVACY** — 루트에 존재(전부 permissive, 상업 사용 허용).
- [ ] 버전 = `tauri.conf.json`·`Cargo.toml`·`package.json` 동기(현재 `0.1.0`), 배포 커밋 후 git 태그(`vX.Y.Z`).
- [ ] 실신원 MSIX는 Partner Center 예약 후 재빌드(위 `-IdentityName`/`-Publisher`).
