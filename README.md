# Investment Tracker

A cross-platform mobile app built with Capacitor for tracking investment portfolios across multiple channels. It automatically calculates:

- **Difference**: Change in total assets compared to last record
- **Deposit Amount**: New capital added during this period
- **Period Return**: Difference minus deposits, reflecting actual investment returns
- **Cumulative Return**: Sum of all historical returns

All data is stored locally on the device — no internet connection required.

## Tech Stack

- [Capacitor](https://capacitorjs.com/): Bridges web app to native Android APK
- HTML / CSS / JavaScript (no framework)
- Tailwind CSS (CDN)
- IBM Plex Sans font
- Capacitor Filesystem: Native file storage on mobile
- localStorage: Fallback storage for browser debugging

## Local Development

No Android SDK required — runs directly in the browser.

### Option 1: Python HTTP Server (Recommended)

```bash
python -m http.server 8080 --directory www
```

Open http://localhost:8080 in your browser.

### Option 2: Node Static Server

```bash
npx serve www -l 8080
```

> Note: `npx cap serve` is deprecated in newer Capacitor versions.

For best results, resize your browser to mobile dimensions (e.g., 375×812) or use DevTools mobile emulation.

## Build APK

### Option 1: Android Studio (Recommended)

1. Install [Android Studio](https://developer.android.com/studio).
2. Run from project root:

   ```bash
   npx cap open android
   ```

3. Wait for Gradle sync to complete.
4. Click **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
5. Click **locate** in the bottom-right notification to find `app-debug.apk`.

### Option 2: Command Line

```bash
npx cap sync android
cd android
./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

## Calculation Rules

Enter only **Total Value** and **Cumulative Return** — the app computes everything else:

```
Principal = Total Value - Cumulative Return

Period Return = Current Cumulative Return - Previous Cumulative Return
Period Deposit = Current Principal - Previous Principal
Period Return Rate = Period Return / Previous Principal × 100%
```

Example:

| Month | Total Value | Cumulative Return | Principal | Period Return | Return Rate | Deposit |
|-------|-------------|-------------------|-----------|---------------|-------------|---------|
| Jan   | 10,000      | 0                 | 10,000    | 0             | 0.00%       | 10,000  |
| Feb   | 13,000      | 2,000             | 11,000    | 2,000         | 20.00%      | 1,000   |

For the first record, enter `0` for cumulative return — the deposit equals your initial principal.

## Data Storage

**Mobile (APK)**: Data is saved in the app's private directory (`Directory.Data`) via Capacitor Filesystem.

- **Clearing cache does NOT delete data** — files are stored outside the cache directory.
- **Uninstalling the app or clearing all data WILL delete** — same as any app.
- **Browser debugging**: Falls back to `localStorage` for convenience.

Use the export backup feature regularly to create JSON backups. You can import them to restore data after reinstalling or switching devices.

## Project Structure

```
app_fund/
├── www/                    # Web app source
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── android/                # Capacitor Android project
├── capacitor.config.json   # Capacitor config
├── package.json
└── README.md
```

## Common Commands

```bash
# Install dependencies
npm install

# Sync web assets to Android project
npx cap sync android

# Open Android Studio
npx cap open android

# Preview in browser
python -m http.server 8080 --directory www
```

## Troubleshooting

1. **Run commands from project root** — `www` is a relative path.
2. **Verify `www/index.html` exists** — missing file causes 404.
3. **Change port if busy**:
   ```bash
   python -m http.server 8081 --directory www
   ```
4. **Use `http://` not `https://`** — localhost doesn't need HTTPS.
5. **Check firewall/antivirus** — may block local ports.
6. **Check terminal output** — `Serving HTTP on :: port 8080` confirms server is running.
