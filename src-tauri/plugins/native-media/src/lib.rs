use tauri::Manager;

#[tauri::plugin]
pub struct NativeMediaPlugin;

impl NativeMediaPlugin {
    pub fn new() -> Self {
        Self
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(NativeMediaPlugin::new())
        .setup(|app| {
            log::info!("NativeMediaPlugin loaded");
            #[cfg(debug_assertions)]
            {
                let _ = app.get_webview_window("main");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running native-media plugin");
}
