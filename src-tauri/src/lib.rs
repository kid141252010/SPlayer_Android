// src-tauri/src/lib.rs

// Declare modules
mod android_fs;
mod audio_player;

use audio_player::AudioState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            android_fs::read_lyric_dir_android,
            android_fs::read_lyric_file_android,
            // Audio playback commands
            audio_player::play_audio,
            audio_player::preload_audio,
            audio_player::pause_audio,
            audio_player::resume_audio,
            audio_player::stop_audio,
            audio_player::seek_audio,
            audio_player::set_volume,
            audio_player::get_position,
            audio_player::get_duration,
            audio_player::get_playback_state,
            audio_player::get_metadata,
        ])
        .setup(|app| {
            use tauri::Manager;
            app.manage(AudioState::new(app.handle().clone()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}