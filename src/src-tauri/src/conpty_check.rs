use std::path::{Path, PathBuf};

/// Where `conpty.dll` actually came from — the only question that matters.
///
/// `portable-pty` loads it by bare filename and **falls back to `kernel32` in silence** if that
/// fails, and its `CONPTY` handle is a private `lazy_static` with no accessor. So we cannot ask it;
/// we have to reproduce the load ourselves and look at where Windows resolved it from. Anything
/// short of that (e.g. "the file exists") misses the case where the file is present but unloadable
/// — wrong architecture, corrupt, blocked — which is exactly when the silent fallback bites.
#[derive(Debug, PartialEq, Eq)]
pub enum ConPtyOrigin {
    /// Loaded from next to our exe. This is the one we want.
    Sideloaded(PathBuf),
    /// Loaded, but from somewhere else (System32) — i.e. the OS ConPTY, bugs and all.
    System(PathBuf),
    /// Did not load. portable-pty is on `kernel32` right now.
    NotLoaded(String),
}

pub fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

/// Load `conpty.dll` the same way portable-pty does and report where it resolved from.
///
/// Loading is process-wide and refcounted, so doing this before portable-pty pins the same module
/// it will get; doing it after is a no-op that returns the already-loaded one. Either way the answer
/// is the truth about this process. We deliberately do not free the library.
#[cfg(windows)]
pub fn conpty_origin() -> ConPtyOrigin {
    use windows::core::s;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::System::LibraryLoader::{GetModuleFileNameA, GetProcAddress, LoadLibraryA};

    // Bare filename on purpose: this is the exact string portable-pty passes, so we exercise the
    // same DLL search order rather than a path we picked.
    let module: HMODULE = match unsafe { LoadLibraryA(s!("conpty.dll")) } {
        Ok(m) if !m.is_invalid() => m,
        Ok(_) => return ConPtyOrigin::NotLoaded("LoadLibraryA returned a null module".into()),
        Err(e) => return ConPtyOrigin::NotLoaded(format!("LoadLibraryA failed: {e}")),
    };

    // A DLL that loads but doesn't export the entry point would fail later, inside the first spawn.
    if unsafe { GetProcAddress(module, s!("CreatePseudoConsole")) }.is_none() {
        return ConPtyOrigin::NotLoaded("loaded but CreatePseudoConsole is not exported".into());
    }

    let mut buf = [0u8; 1024];
    let len = unsafe { GetModuleFileNameA(Some(module), &mut buf) } as usize;
    if len == 0 || len >= buf.len() {
        return ConPtyOrigin::NotLoaded("GetModuleFileNameA failed".into());
    }
    let path = PathBuf::from(String::from_utf8_lossy(&buf[..len]).to_string());

    let ours = exe_dir()
        .zip(path.parent().map(Path::to_path_buf))
        .map(|(a, b)| paths_eq(&a, &b))
        .unwrap_or(false);

    if ours {
        ConPtyOrigin::Sideloaded(path)
    } else {
        ConPtyOrigin::System(path)
    }
}

#[cfg(not(windows))]
pub fn conpty_origin() -> ConPtyOrigin {
    ConPtyOrigin::NotLoaded("windows only".into())
}

/// Case-insensitive compare after canonicalising, because Windows hands back mixed casing and
/// sometimes a short (8.3) path.
fn paths_eq(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        std::fs::canonicalize(p)
            .unwrap_or_else(|_| p.to_path_buf())
            .to_string_lossy()
            .to_lowercase()
    };
    norm(a) == norm(b)
}
