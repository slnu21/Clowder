use std::path::{Path, PathBuf};

fn main() {
    copy_conpty();
    tauri_build::build()
}

/// Put `conpty.dll` + `OpenConsole.exe` next to the built exe.
///
/// `portable-pty` loads `conpty.dll` **by bare filename**, so Windows resolves it from the exe's
/// directory — and if it isn't there it falls back to `kernel32` **silently** (see conpty/README.md).
/// `tauri dev` runs `target/<profile>/deck.exe`, so without this the whole of development happens on
/// the buggy OS ConPTY without a single visible sign.
///
/// Release bundling is handled separately by `bundle.resources` in tauri.conf.json.
fn copy_conpty() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let src = manifest.join("conpty");

    // OUT_DIR is target/<profile>/build/<pkg>-<hash>/out — climb back to target/<profile>/.
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let Some(target_dir) = out.ancestors().nth(3) else {
        println!("cargo:warning=conpty: could not resolve target dir from OUT_DIR");
        return;
    };

    for name in ["conpty.dll", "OpenConsole.exe"] {
        let from = src.join(name);
        // Rebuild when the vendored binaries change (e.g. a version bump).
        println!("cargo:rerun-if-changed={}", from.display());
        copy_one(&from, &target_dir.join(name), name);
    }
}

fn copy_one(from: &Path, to: &Path, name: &str) {
    if !from.exists() {
        // A warning, not a panic: --selftest is the gate that actually refuses to pass without
        // these, and it gives a far better message than a build failure here would.
        println!("cargo:warning=conpty: {} missing at {}", name, from.display());
        return;
    }
    if let Err(e) = std::fs::copy(from, to) {
        // Copying over a DLL held by a running dev instance fails — harmless, the file is already
        // there and identical.
        println!("cargo:warning=conpty: copy {} failed: {}", name, e);
    }
}
