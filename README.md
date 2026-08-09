# StockFlow

Installable barcode inventory PWA for macOS and iPhone. It runs immediately in local demo mode and includes a Supabase adapter for cloud synchronization.

## Features

- USB/Bluetooth HID barcode scanning on Mac (keyboard-wedge scanners)
- iPhone camera scanning with ZXing
- Product index: barcode, SKU, name, category, location and reorder level
- Stock in, stock out and absolute stock adjustment
- Low-stock dashboard and immutable movement history
- Search and UTF-8 CSV exports
- Offline-capable PWA with localStorage fallback
- Supabase/PostgreSQL adapter with per-account Row Level Security
- Manager/employee team accounts (Supabase mode only) — an employee can scan,
  count and sell stock, but can't see cost/profit, delete a product, change
  what it costs or sells for, override a sale price, approve a stocktake
  recount, or process a refund, goodwill gesture or write-off

## Run locally

Requires Node.js 20 or newer.

```bash
cd /home/ubuntuadmin/stockflow-pwa
npm install
npm run dev
```

Open `http://localhost:5173`. Without environment variables, StockFlow automatically uses its local demo database.

## Verify

```bash
cd /home/ubuntuadmin/stockflow-pwa
npm test -- --run
npm run typecheck
npm run build
npm run preview
```

The production preview runs at `http://localhost:4173`.

## Barcode scanners

### Mac USB/Bluetooth scanner

1. Pair or connect a scanner configured as a HID keyboard.
2. Configure its suffix to send **Enter/Return** after every barcode.
3. Open StockFlow and scan from any screen while no edit dialog is open.
4. StockFlow opens the matching product; unknown codes open the new-product workflow.

### iPhone camera

1. Deploy over HTTPS (camera access is blocked on ordinary HTTP origins).
2. Open **Scan** and tap **Start camera**.
3. Allow camera permission and hold the barcode inside the frame.
4. In Safari, use **Share > Add to Home Screen** to install the PWA.

## Supabase cloud database

1. Create a Supabase project.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it.
3. In **Authentication > Providers**, enable Email.
4. Copy `.env.example` to `.env.local`:

```bash
cd /home/ubuntuadmin/stockflow-pwa
cp .env.example .env.local
```

5. Replace the two values in `.env.local` with **Project Settings > API > Project URL** and the public anon key.
6. Restart `npm run dev`.

The schema scopes every product and movement to the signed-in *account* through Row Level Security. The repository expects an authenticated Supabase session. Local mode runs with no credentials at all — see below.

### Sign-in: magic link only, with mandatory authenticator MFA

StockFlow has no password sign-in at all — email magic link is the only way in, and every account must enroll a TOTP authenticator app (Google Authenticator, 1Password, Authy, etc.) immediately after their first sign-in. This is enforced twice: the app walks a new session through enrollment/verification before showing any screen, and `supabase/schema.sql` refuses to resolve an account (so every table's Row Level Security policy denies access) for a session that hasn't verified a TOTP factor and reached AAL2 — so it can't be bypassed by calling the API directly.

Dashboard setup for this to work on a deployed domain:

1. **Authentication > Providers > Email**: keep Email enabled; "Confirm email" can stay on, since the magic link itself is the confirmation.
2. **Authentication > URL Configuration**: set **Site URL** to your production domain (e.g. `https://stockflow.example.com`) and add it under **Redirect URLs** too. Add any preview/staging domains the same way — a magic link or a stale bookmark that redirects to a URL not on this list fails with a page-not-found rather than signing in.
3. **Authentication > Multi-Factor Authentication**: enable **TOTP**. StockFlow's own AAL2 check in `schema.sql` is what makes MFA mandatory — this dashboard toggle just needs to be on so the `auth.mfa.enroll()` calls succeed.

### Team accounts (manager/employee)

Already running Supabase and just adding this? Re-run `supabase/schema.sql` in the SQL Editor — every statement is safe to re-run and existing single-user accounts are backfilled as the manager of their own account automatically. Nothing else needs to change for anyone who never invites a teammate.

To bring an employee on:

1. Sign in as yourself and open **Settings > Team**.
2. Enter their email under "Invite an employee" and submit. This only works signed in as a manager (the account owner, by default).
3. Have them open StockFlow and **sign up** (not sign in) using that *exact* email address. They're linked into your account automatically the moment their account is created — invite first, then have them sign up, in that order.
4. They'll see the same app with a few things missing: no cost or profit anywhere, no deleting a product or changing what it costs/sells for, no overriding a sale price at checkout, no approving a stocktake recount, and no processing a refund, goodwill gesture or write-off. Everything else — scanning, counting, selling at the listed price, adding new products — works the same as it does for you.

Local (offline demo) mode has no real second login, so it always runs as manager — team accounts only apply once Supabase is connected.

## Downloadable apps (Mac, Windows, Android, iPhone)

The same React/Vite code above is wrapped two different ways for native installs — Electron for Mac/Windows desktop, Capacitor for Android/iPhone — rather than being rewritten per platform. Everything below builds something you install and run directly on your own device; none of it publishes anywhere or needs a store account.

Always rebuild the web app first:

```bash
cd /home/ubuntuadmin/stockflow-pwa
npm install
npm run build
```

### Mac (.dmg)

```bash
npm run electron:build:mac
```

Produces `release/StockFlow-<version>.dmg`. Open it and drag StockFlow into Applications. First launch, right-click the app and choose **Open** — it's unsigned, so a plain double-click gets blocked as "unidentified developer."

### Windows (.exe)

Run this on an actual Windows machine — simplest way to avoid cross-build headaches:

```bash
npm run electron:build:win
```

Produces `release/StockFlow Setup <version>.exe`. Running it triggers a SmartScreen warning since it's unsigned — click **More info > Run anyway**.

### Android (.apk)

Requires Android Studio installed once.

```bash
npx cap add android      # first time only — scaffolds the android/ folder
npm run cap:android      # builds the web app, syncs, opens Android Studio
```

Plug in your phone (enable **Developer Options > USB debugging** first) and hit Android Studio's green Run button, or **Build > Build Bundle(s)/APK(s) > Build APK(s)** to get a standalone `.apk` file to send yourself. No Play Store involved either way.

### iPhone

Requires a Mac with Xcode (free from the App Store) and a cable.

```bash
npx cap add ios      # first time only — scaffolds the ios/ folder
npm run cap:ios       # builds the web app, syncs, opens Xcode
```

In Xcode: select your iPhone as the run destination top-left, sign in under **Xcode > Settings > Accounts** with your Apple ID if you haven't, pick your name as the **Team** in the project's Signing & Capabilities tab, then hit **Run**. First time only, go to **iPhone Settings > General > VPN & Device Management** and trust your developer certificate once.

A free Apple ID is enough for this — no paid account required to test on your own phone. The one limit: a free account's install expires after 7 days, so you just re-run from Xcode to refresh it. The $99/year (£79/year in the UK) Apple Developer account only matters once you want TestFlight or an actual App Store listing.

### iPhone — testing with other people (TestFlight)

Not needed for using StockFlow yourself — the free PWA (**Safari > Share > Add to Home Screen**) keeps working with no account at all, side by side with everything below. This is only for handing a native build to other people's iPhones without publishing to the App Store, which Apple doesn't allow without at least this.

1. Enrol at [developer.apple.com/programs](https://developer.apple.com/programs) — $99/year (£79/year in the UK, VAT included). Personal or sole-trader enrolment is instant; a registered company needs a D-U-N-S number first, which can take longer.
2. In **App Store Connect** (appstoreconnect.apple.com), create a new app record — bundle ID must match `com.masonsfinds.stockflow` from `capacitor.config.ts`, registered first under **Certificates, IDs & Profiles > Identifiers**.
3. In Xcode, set the same signing Team as your paid account, then **Product > Archive**, and use the Organizer window's **Distribute App > TestFlight & App Store** to upload the build.
4. Back in App Store Connect, under the app's **TestFlight** tab:
   - **Internal testers** — add up to 100 people who are members of your App Store Connect team; they get the build instantly by email invite, no Apple review involved.
   - **External testers** — invite anyone by email or share a public link (up to 10,000 testers); the first build goes through a lightweight **Beta App Review** (usually under a day, far less strict than a full App Store review), after which updates ship instantly.
5. Testers install the **TestFlight** app from the App Store, accept the email/link invite, and get StockFlow through it — it shows a countdown to expiry (builds expire after 90 days, just upload a new one to extend).

None of this requires ever actually submitting StockFlow to the public App Store — TestFlight is Apple's sanctioned "send it to people without publishing it" path, it just isn't free.

### Camera permission (barcode scanning)

Each native shell needs one manual permission wire-up the first time:

- **iOS** — after `npx cap add ios`, open `ios/App/App/Info.plist` and add:
  ```xml
  <key>NSCameraUsageDescription</key>
  <string>StockFlow uses the camera to scan product barcodes.</string>
  ```
- **Android** — Capacitor usually adds the camera permission automatically; if scanning never prompts for it, add `<uses-permission android:name="android.permission.CAMERA" />` to `android/app/src/main/AndroidManifest.xml`.

### App icon

`build/icon.png` is a copy of the existing 512×512 PWA icon, fine for testing. Apple and Google both want cleaner exports at actual submission time (1024×1024 for iOS, layered adaptive icon for Android) — not needed until you're ready to publish.

## Deploy to Vercel

```bash
cd /home/ubuntuadmin/stockflow-pwa
npm install -g vercel
vercel login
vercel
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel --prod
```

Enter the real Supabase values when prompted. Vercel supplies HTTPS, which is required for iPhone camera access and service workers.

## Project structure

- `src/domain/` — tested inventory, movement, search and CSV rules
- `src/data/` — localStorage and Supabase repository adapters
- `src/scanner/` — HID wedge buffering and camera scanner
- `src/ui/` — responsive screens, dialogs and hooks
- `supabase/schema.sql` — PostgreSQL tables, indexes and RLS policies
- `dist/` — generated production PWA after `npm run build`
