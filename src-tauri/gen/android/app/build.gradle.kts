import java.util.Properties

// --- 读取签名配置文件 (已转换为 Kotlin 语法) ---
val keystorePropertiesFile = rootProject.file("../../keystore.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.canRead()) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 35
    namespace = "com.kid.splayer"
    defaultConfig {
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.kid.splayer"
        minSdk = 24
        targetSdk = 35
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }

    // === 修改：配置签名参数 (支持从环境变量读取，且变为可选) ===
    signingConfigs {
        create("release") {
            val sFile = keystoreProperties.getProperty("storeFile") ?: System.getenv("ANDROID_KEYSTORE_FILE")
            if (!sFile.isNullOrEmpty()) {
                val file = rootProject.file(sFile)
                if (file.exists()) {
                    storeFile = file
                    storePassword = keystoreProperties.getProperty("storePassword") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
                    keyAlias = keystoreProperties.getProperty("keyAlias") ?: System.getenv("ANDROID_KEY_ALIAS")
                    keyPassword = keystoreProperties.getProperty("keyPassword") ?: System.getenv("ANDROID_KEY_PASSWORD")
                } else {
                    println("!! WARNING !!: Keystore file not found at: ${file.absolutePath}")
                    println("Release build will be UNSIGNED.")
                }
            } else {
                println("!! WARNING !!: ANDROID_KEYSTORE_FILE environment variable is empty or null.")
                println("Release build will be UNSIGNED.")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
            }
        }
        getByName("release") {
            // === 修改：仅在签名文件存在时才应用签名 ===
            val releaseConfig = signingConfigs.getByName("release")
            if (releaseConfig.storeFile != null && releaseConfig.storeFile!!.exists()) {
                signingConfig = releaseConfig
            } else {
                println("Note: Building unsigned APK as no keystore was found.")
            }
            
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.media:media:1.6.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")