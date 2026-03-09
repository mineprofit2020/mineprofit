# Building MineProfit APK Files

## Prerequisites
- Android Studio (free) — https://developer.android.com/studio
- OR just the Android SDK command-line tools + JDK 17

## Steps

### 1. Set Your Server URL
Edit the `APP_URL` constant in each `MainActivity.java`:
- **User app:** `apk-source/user/app/src/main/java/com/mineprofit/app/MainActivity.java`
- **Admin app:** `apk-source/admin/app/src/main/java/com/mineprofit/admin/MainActivity.java`

Replace `https://your-server-domain.com` with your actual deployed server URL.

### 2. Add an App Icon
Place a 192×192 PNG file named `ic_launcher.png` in:
- `apk-source/user/app/src/main/res/drawable/ic_launcher.png`
- `apk-source/admin/app/src/main/res/drawable/ic_launcher.png`

### 3. Build with Android Studio (Easiest)
1. Open Android Studio
2. Click **File → Open** → select `apk-source/user/` (or `admin/`)
3. Wait for Gradle sync to complete
4. Click **Build → Build Bundle(s) / APK(s) → Build APK(s)**
5. APK will be generated at `app/build/outputs/apk/debug/app-debug.apk`

### 3b. Build via Command Line (Alternative)
```bash
cd apk-source/user
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

### 4. Copy APKs to Download Location
```bash
cp apk-source/user/app/build/outputs/apk/debug/app-debug.apk public/apk/mineprofit-user.apk
cp apk-source/admin/app/build/outputs/apk/debug/app-debug.apk public/apk/mineprofit-admin.apk
```

### Quick Alternative: Use Online APK Builders
If you don't want to install Android Studio, use free online WebView-to-APK converters:
- **AppCreator24** — https://appcreator24.com
- **WebIntoApp** — https://www.webintoapp.com
- **Gonative** — https://gonative.io

Just enter your website URL and they generate the APK for you.

## Notes
- The APK is a thin WebView wrapper — all logic runs on your web server
- Users need internet access to use the app
- Android 5.0+ (API 21) is supported
- For Play Store publishing, you'll need to sign the APK with a release keystore
