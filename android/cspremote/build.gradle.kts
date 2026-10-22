plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // Android ships org.json; the JVM tests need the real artifact.
    compileOnly(libs.org.json)
    testImplementation(libs.org.json)
    testImplementation(libs.junit)
}
