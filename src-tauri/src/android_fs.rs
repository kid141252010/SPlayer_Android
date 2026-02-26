// src-tauri/src/android_fs.rs

use serde::{Deserialize, Serialize};
use tauri::{command, Runtime};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LyricFile {
    pub name: String,
    pub path: String,
}

#[command]
pub fn read_lyric_dir_android<R: Runtime>(
    _window: tauri::Window<R>,
    uri: String,
) -> Result<Vec<LyricFile>, String> {
    #[cfg(target_os = "android")]
    {
        read_dir_physical(uri).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = uri;
        Err("Android only".to_string())
    }
}

#[command]
pub fn read_lyric_file_android<R: Runtime>(
    _window: tauri::Window<R>,
    uri: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use std::fs;
        let path = uri.trim_start_matches("file://");
        fs::read_to_string(path).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = uri;
        Err("Android only".to_string())
    }
}

#[cfg(target_os = "android")]
fn read_dir_physical(uri_str: String) -> anyhow::Result<Vec<LyricFile>> {
    use std::fs;
    use std::io::Read;
    use std::path::Path;

    let mut files = Vec::new();
    let root_path = uri_str.trim_start_matches("file://");

    // 🌟 深度 ID 提取：读 8KB 确保抓到 ncmMusicId
    fn extract_id(path: &Path) -> Option<String> {
        let mut file = fs::File::open(path).ok()?;
        let mut buffer = vec![0; 8192];
        let n = file.read(&mut buffer).ok()?;
        let content = String::from_utf8_lossy(&buffer[..n]);

        if let Some(pos) = content.find("ncmMusicId") {
            let sub = &content[pos..];
            if let Some(v_idx) = sub.find("value=\"") {
                let start = v_idx + 7;
                if let Some(end) = sub[start..].find("\"") {
                    return Some(sub[start..start + end].to_string());
                }
            }
        }
        None
    }

    // 🌟 递归扫描：钻进所有子文件夹
    fn visit(dir: &Path, files: &mut Vec<LyricFile>) -> std::io::Result<()> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    let _ = visit(&path, files);
                } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext_l = ext.to_lowercase();
                    if ext_l == "lrc" || ext_l == "ttml" {
                        let mut display_name =
                            path.file_name().unwrap().to_string_lossy().to_string();
                        // 如果是 ttml，尝试用 ID 欺骗前端匹配
                        if ext_l == "ttml" {
                            if let Some(id) = extract_id(&path) {
                                display_name = format!("{}.ttml", id);
                            }
                        }
                        files.push(LyricFile {
                            name: display_name,
                            path: path.to_string_lossy().into_owned(),
                        });
                    }
                }
            }
        }
        Ok(())
    }

    let _ = visit(Path::new(root_path), &mut files);
    Ok(files)
}
