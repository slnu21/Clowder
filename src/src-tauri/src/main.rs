// Prevents an extra console window on Windows in release. DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Headless gate: no window, no webview. Must run before the Tauri builder so CI and a plain
    // shell can both use it.
    if std::env::args().skip(1).any(|a| a == "--selftest") {
        std::process::exit(deck_lib::selftest::run());
    }
    deck_lib::run()
}
