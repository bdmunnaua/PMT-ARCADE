# PMT Arcade — Android app

A Trusted Web Activity: the app opens https://pmtarcade.com full screen on Chrome's engine, so
Google sign-in, voice chat and every website update work in the app at once (no new APK needed).

- First start: asks for the microphone (voice chat) and notifications together, then opens the game.
- pmtarcade.com links (room invites) open in the app.
- Phones without Chrome fall back to the built-in web view.

## Build

Open this `android` folder in Android Studio, or from a terminal:

    set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
    gradlew.bat assembleRelease

The signed APK is `app/build/outputs/apk/release/app-release.apk`.

## Signing key — back it up

The release key is `../private/pmtarcade-release.jks`, its passwords are in
`../private/android-keystore.properties` (both outside git). Every update of the app must be signed
with this same key, so keep a copy somewhere safe (USB stick / Google Drive). If it is lost, the app
cannot be updated, only re-published under a new name.

The website proves it owns the app with `apps/web/public/.well-known/assetlinks.json` (the key's
SHA-256). If the key ever changes, update that file too.

## New version

Raise `versionCode` (and `versionName`) in `app/build.gradle.kts`, then build again.
