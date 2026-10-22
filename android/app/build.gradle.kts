import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Release signing: a properties file outside the repo (storeFile, storePassword, keyAlias, keyPassword), named by the
// Gradle property okpicker.signing, e.g. in ~/.gradle/gradle.properties. Without it the release APK comes out unsigned.
val signing = providers.gradleProperty("okpicker.signing").orNull?.let { f ->
    Properties().apply { file(f).inputStream().use { load(it) } }
}

android {
    namespace = "com.luap.okpicker"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.luap.okpicker"
        minSdk = 33
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        if (signing != null) create("release") {
            storeFile = file(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.findByName("release")
        }
    }

    // The panel is the stage 1 bundle, used as built (picker/: npm run build).
    sourceSets.getByName("main").assets.srcDir("../../picker/dist")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    implementation(project(":cspremote"))
    implementation(libs.zxing.core)
}
