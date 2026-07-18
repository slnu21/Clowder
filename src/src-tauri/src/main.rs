// Prevents an extra console window on Windows in release. DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Headless gates: no window, no webview. Must run before the Tauri builder so CI, a plain shell,
    // and Claude Code hooks can all use it.
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--selftest") {
        std::process::exit(clowder_lib::selftest::run());
    }
    // Hook beacon: Claude Code spawns `clowder.exe --beacon --event <E>`. Silent, writes a spool, exits.
    if args.iter().any(|a| a == "--beacon") {
        clowder_lib::beacon::run(&args);
        std::process::exit(0);
    }
    clowder_lib::run()
}
