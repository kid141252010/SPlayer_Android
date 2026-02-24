# Session Context: Android Native Playback Implementation

## Objective
Implement native audio playback for Android (via Tauri/Rust) to replace Web Audio API limitations on mobile, and remove FFmpeg/MPV dependencies to simplify the architecture.

## Changes Implemented

### 1. Backend (Rust - `src-tauri/`)
- **Dependencies:** Added `rodio` (0.19) and `reqwest` (0.12, with `rustls-tls` features) to `Cargo.toml`. `rustls-tls` is crucial for Android to avoid OpenSSL compilation issues.
- **Audio Module (`src/audio_player.rs`):**
  - Implemented a threaded audio manager using `rodio`.
  - **Features:** Play (Local/HTTP), Pause, Resume, Stop, Seek, Volume, Get Position.
  - **Lazy Initialization:** Audio device (`OutputStream`) is initialized only on the first play command to prevent startup crashes on Android.
  - **Streaming:** HTTP URLs are currently buffered to memory (via `Cursor`) to satisfy `rodio`'s `Seek` requirement.
- **Commands:** Registered Tauri commands (`play_audio`, `pause_audio` etc.) in `src/lib.rs`.

### 2. Frontend (TypeScript - `src/`)
- **Native Player (`src/core/audio-player/NativePlayer.ts`):**
  - Created a new class implementing `IPlaybackEngine`.
  - Bridges calls to Rust via `Tauri invoke`.
- **Audio Manager (`src/core/player/AudioManager.ts`):**
  - Logic updated to detect environment.
  - **Electron:** Uses `AudioElementPlayer` (Web Audio).
  - **Tauri (Mobile):** Uses `NativePlayer`.
- **Cleanup:**
  - Removed `FFmpegAudioPlayer` and `MpvPlayer` code and files.
  - Removed `audioEngine` and `playbackEngine` settings from `src/stores/setting.ts` and UI configs (`src/components/Setting/config/`).
  - Removed `MpvService` from Electron main process.

### 3. Build & Configuration
- **Dependencies:** Added `@tauri-apps/api` to `package.json`.
- **Android Config:**
  - `tauri.conf.json`: Removed invalid `android.permissions` block.
  - `AndroidManifest.xml`: Permissions (`INTERNET`, `WAKE_LOCK`, `MODIFY_AUDIO_SETTINGS`) should be verified in `src-tauri/gen/android/app/src/main/AndroidManifest.xml`.

## Current Status
- **Build:** Android build (`pnpm tauri android build --debug`) succeeds.
- **Artifact:** `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
- **Known Behavior:**
  - Application uses native audio on Android.
  - Startup crash (flash back) resolved via lazy audio initialization.
  - HTTP streaming loads entire file to memory first (for `rodio` seek support).

## Future Tasks / TODO
- [ ] Optimize HTTP streaming (implement true streaming source for `rodio` or use a different library if memory usage is too high).
- [ ] Implement Metadata extraction (duration, artist, etc.) on the Rust side for `NativePlayer` (currently returns 0 duration initially).
- [ ] Verify `WAKE_LOCK` behavior on long playback.
