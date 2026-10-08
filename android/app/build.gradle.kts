import java.util.Properties

plugins {
    id("com.android.application")
}

// release signing key: kept outside git, in pmtarcade.com/private (back it up — every update needs it)
val keystoreProps = Properties().apply {
    val f = rootProject.file("../private/android-keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.pmtarcade.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pmtarcade.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 4
        versionName = "1.3"
    }

    // two editions from one project:
    //  play — Google Play (com.pmtarcade.app): opens the site's Play edition (free arcade games only)
    //  full — the APK shared from pmtarcade.com (com.pmtarcade.full): the complete site
    flavorDimensions += "store"
    productFlavors {
        create("play") {
            dimension = "store"
            resValue("string", "launch_url", "https://pmtarcade.com/?edition=play")
        }
        create("full") {
            dimension = "store"
            applicationId = "com.pmtarcade.full"
            resValue("string", "launch_url", "https://pmtarcade.com/?source=android-app")
        }
    }

    buildFeatures {
        resValues = true
    }

    signingConfigs {
        create("release") {
            if (keystoreProps.isNotEmpty()) {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystoreProps.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
