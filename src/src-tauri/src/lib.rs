pub mod conpty_check;
pub mod pty;
pub mod selftest;

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
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            default_shell,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn default_shell() -> String {
    pty::default_shell()
}
