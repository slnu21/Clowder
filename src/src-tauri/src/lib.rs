pub mod beacon;
pub mod beacon_install;
pub mod conpty_check;
pub mod correlate;
pub mod fs_ops;
pub mod link;
pub mod liveness;
pub mod pty;
pub mod quote;
pub mod selftest;
pub mod sessions;
pub mod settings;
pub mod spool;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)] // reassigned only in release, where single-instance is registered
    let mut builder = tauri::Builder::default();

    // single-instance is **release only**. In debug a fresh `tauri dev` build collides with the
    // instance already running and exits immediately — a full afternoon of confusion if you don't
    // know. (md-reader learned this; see its lib.rs.)
    #[cfg(not(debug_assertions))]
    {
        use tauri::Manager;
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // set_focus() alone does not raise a minimized or buried window on Windows.
            // unminimize -> show -> set_focus is the order that actually works.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Clipboard goes through Rust rather than `navigator.clipboard`: the webview API needs a
        // secure context *and* live user activation, and inside WebView2 it fails with a bare
        // NotAllowedError whenever either is missing. A copy that silently doesn't copy is worse
        // than no copy button at all.
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            default_shell,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            fs_ops::list_drives,
            fs_ops::list_dir,
            fs_ops::default_root,
            fs_ops::read_file,
            fs_ops::read_file_base64,
            link::resolve_link_target,
            quote::quote_path_cmd,
            sessions::sessions_snapshot,
            settings::get_settings,
            settings::save_settings,
            settings::resolve_shell_cmd,
            beacon_install::beacon_installed,
            beacon_install::beacon_install,
            beacon_install::beacon_uninstall,
        ])
        .setup(|app| {
            // If session tracking is installed, refresh the staged beacon binary so an app update
            // propagates without a reinstall. Off-thread: never block startup on a file copy.
            std::thread::spawn(beacon_install::refresh_beacon_binary_on_startup);

            // The session board watches the beacon spool on a background thread and pushes updates to
            // the frontend. It needs the AppHandle to emit, so it starts here.
            use tauri::Manager;
            let handle = app.handle().clone();
            app.manage(sessions::start(handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn default_shell() -> String {
    pty::default_shell()
}
