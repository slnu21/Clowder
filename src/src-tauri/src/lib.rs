pub mod beacon;
pub mod beacon_install;
pub mod conpty_check;
pub mod correlate;
pub mod docker;
pub mod fs_ops;
pub mod git;
pub mod k8s;
pub mod link;
pub mod liveness;
pub mod ports;
pub mod pty;
pub mod quote;
pub mod selftest;
pub mod sessions;
pub mod settings;
pub mod snippets;
pub mod spool;
pub mod ssh;
pub mod tasks;

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
        // **Which thread a command runs on is a correctness decision here, not a tuning knob.**
        //
        // A bare `#[tauri::command]` is `ExecutionContext::Blocking` — tauri-macros labels it `"sync"`
        // and runs the body inline on the IPC handler thread, which on Windows is the WebView2 message
        // pump (the main thread). Adding `(async)` moves it to `"sync_threadpool"`. Everything below
        // that touches the filesystem or shells out (`git`, `docker`, `kubectl`) is therefore
        // `(async)`: a `docker ps` against a sleeping daemon used to block paint, input dispatch and
        // *every other command* for seconds. That was the "come back to the window and typing is dead
        // for a few seconds" bug — `pty_write` was queued behind a probe nobody asked for.
        //
        // The `pty_*` commands stay sync **deliberately**. Keystrokes must reach the shell in the order
        // they were typed, and IPC messages are drained in order on one thread; scattering them across
        // threadpool tasks would let two writes race. Sync on a main thread that is no longer blocked
        // is both ordered and immediate. `quote_path_cmd` (pure string work) and `sessions_snapshot`
        // (a mutex clone) are sync because they are already microseconds. `session_dismiss` and
        // `sessions_dismiss_dead` delete spool files, so they are `(async)` like every other command
        // that touches the disk.
        .invoke_handler(tauri::generate_handler![
            default_shell,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            ports::list_ports,
            ports::kill_process,
            ssh::ssh_hosts,
            git::git_status,
            k8s::kubectl_contexts,
            k8s::kubectl_use_context,
            k8s::kubectl_pods,
            k8s::kubectl_namespaces,
            k8s::kubectl_use_namespace,
            docker::docker_ok,
            docker::docker_containers,
            docker::docker_start,
            docker::docker_stop,
            tasks::list_tasks,
            snippets::get_snippets,
            snippets::set_snippets,
            fs_ops::list_drives,
            fs_ops::list_dir,
            fs_ops::default_root,
            fs_ops::open_folder_in_explorer,
            fs_ops::read_file,
            fs_ops::read_file_base64,
            link::resolve_link_target,
            quote::quote_path_cmd,
            sessions::sessions_snapshot,
            sessions::session_dismiss,
            sessions::sessions_dismiss_dead,
            settings::get_settings,
            settings::save_settings,
            settings::resolve_shell_cmd,
            beacon_install::beacon_status,
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
