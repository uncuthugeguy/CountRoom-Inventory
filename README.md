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
- Supabase/PostgreSQL adapter with per-user Row Level Security

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

The schema scopes every product and movement to `auth.uid()` through Row Level Security. The repository expects an authenticated Supabase session. The current MVP runs without credentials in local mode; the next cloud deployment step is to connect the supplied repository to the desired email login/team-account flow.

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
