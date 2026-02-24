fn main() {
    // === 新增：专治安卓 C++ 依赖丢失 ===
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "android" {
        println!("cargo:rustc-link-lib=c++");
    }
    // === 新增结束 ===

    tauri_build::build()
}