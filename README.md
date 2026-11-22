# Homental — Modular Monolith for Security & Peace-of-Mind Services

Production-grade **NestJS Modular Monolith** backend + **Next.js RTL Persian** schema-driven
frontend. Phase 1 pilot: Smart Security Advisor & Snapp-like Dispatch in **Mashhad** —
designed to scale into a multi-city Super-App without rewriting the core.

## Quick Start

### Option A: Local Development (Infra in Docker, API + Web locally)

#### 1. Infrastructure (PostgreSQL+PostGIS & Redis)

```bash
docker compose up -d          # postgis/postgis:16-3.4 on :5432, redis:7-alpine on :6379
```

#### 2. Backend (NestJS — http://localhost:3000)

```bash
npm install
cp .env.example .env          # DATABASE_URL, REDIS_URL, JWT secrets, OTP_DEV_ECHO=true (dev)
npm run prisma:deploy         # apply migrations (schema + PostGIS triggers/indexes)
npm run prisma:seed           # Mashhad city, branch, technicians, 4 service schemas, 7 advisory rules
npm run start:dev             # API on http://localhost:3000 — Swagger at /docs — health at /health
```

#### 3. Frontend (Next.js — http://localhost:3001)

```bash
cd web
npm install
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1 & NEXT_PUBLIC_WS_URL=http://localhost:3000
npm run dev                   # RTL Persian UI on http://localhost:3001
```

### Option B: One-Command Full-Stack Docker (`postgres` + `redis` + `api` + `web`)

```bash
# Production mode (OTP_DEV_ECHO=false by default):
docker compose --profile fullstack up --build -d

# Seed initial Mashhad data inside the running api container:
docker compose --profile fullstack exec api npx prisma db seed
```

> To run the local OTP demo inside Docker without an SMS provider, pass
> `NODE_ENV=development OTP_DEV_ECHO=true docker compose --profile fullstack up --build -d`
> (Zod blocks `OTP_DEV_ECHO=true` whenever `NODE_ENV=production`).

Open **http://localhost:3001** → choose a location (Path 1) or browse the 3 engineering
pillars (Path 2) → configure services (schema-driven) → watch the live readiness meter &
price range → review the Smart Brief → login with phone OTP (dev code echoed in dev mode)
→ register an address → **ثبت پرونده امنیتی و اعزام کارشناس**.

With `OTP_DEV_ECHO=true` (dev only), login codes and handover OTPs are echoed in API
responses — Zod fails fast if enabled in production.

## Demo Walkthrough — full 4-role Mashhad loop in ~5 minutes

Seed data (after `npm run prisma:seed`) contains these Mashhad pilot phone numbers (login
= phone OTP via the header **ورود** button on any page or inline login prompt; both
canonical `+989...` and local `09...` formats work, with `devCode` echoed in dev mode):

| Role | Phone (local form) | Notes |
|---|---|---|
| Customer | `+989120000020` (`09120000020`, سارا محمدی) | wallet pre-charged ۵۰٬۰۰۰٬۰۰۰ تومان |
| Technician 1 | `+989120000010` (`09120000010`, امیر کریمی) | ALARM + CCTV, rating ۴.۸ |
| Technician 2 | `+989120000011` (`09120000011`, رضا احمدی) | ELECTRIC_SHUTTER + PARKING_JACK, rating ۴.۶ |
| Technician 3 | `+989120000012` (`09120000012`, مهدی نوری) | all 4 skills, rating ۴.۹ |
| Mashhad Branch Admin | `+989120000002` (`09120000002`, حسین رضایی) | شعبه مرکزی مشهد — ۱۰٪ commission override |
| Super Admin | `+989120000001` (`09120000001`, مدیر سامانه) | full platform control & `/admin` finance reserve dashboard |

Steps (use **two browser windows/profiles** — one Customer, one Technician/Branch Admin):

1. **Technician**: open `/technician` and login via the header **ورود** button (or inline
   prompt) → pick **وکیل‌آباد** preset → toggle **آنلاین** so the tech is registered in
   Redis GEO and ready for live Socket.io dispatch offers.
2. **Customer**: open `/` → pick «فروشگاه / مغازه» → apply the one-click advisory
   («+ اعمال پیشنهاد») → continue to `/brief` → choose urgency «فوری» → login with OTP →
   register Mashhad address → **ثبت پرونده امنیتی و اعزام کارشناس** (redirects to `/order/[id]`).
3. **Technician**: the live offer card appears on `/technician` with a 30-second countdown
   (losing techs receive `OFFER_TAKEN` and dismiss immediately) → click **پذیرش سفارش**,
   then **شروع حرکت** → **رسیدم / شروع کارشناسی** → submit the final quote in Toman.
4. **Customer** (`/order/[id]`, live via Socket.io): watch the 9-stage Persian timeline and
   live technician coordinates badge update → in `INSPECTING` the Escrow quote card
   appears (with inline quick wallet top-up if short) → **تأیید قیمت و پرداخت امن (Escrow)**.
5. **Technician**: **شروع نصب و اجرا** → enter hardware serial numbers for `FULL_PACKAGE`
   items (`INSTALL_ONLY` items show exempt) → check BOTH mandatory privacy checklist boxes →
   **صدور کد تحویل (OTP) برای مشتری** (`devHandoverOtp` shown in dev mode) → enter the
   6-digit SMS code → **تکمیل تحویل، فعال‌سازی ضمانت و تسویه**.
6. **Customer**: `/warranties` displays the new `WR-YYYY-XXXXXX` Digital Warranty
   Certificate card (`daysRemaining` + serials) → submit a test claim (**ثبت تیکت خرابی ضمانت**);
   on `/order/[id]` submit a 1–5 star review, and inspect ledger splits on `/wallet`.
7. **Branch Admin** (`/branch`):
   - **صف سفارش‌ها**: filter `BRANCH_QUEUE` & manually assign an `APPROVED` technician.
   - **مدیریت تکنسین‌ها**: view skills/rating/claim rate/online status, approve/suspend, or add a technician.
   - **رسیدگی به تیکت‌های ضمانت**: update claim status (`IN_REVIEW` / `APPROVED` / `RESOLVED` / `REJECTED`) with `resolutionNoteFa` — customer's warranty returns to `ACTIVE` once resolved.
8. **Super Admin** (`/admin`):
   - **داشبورد مالی و صندوق ۵٪ ضمانت**: inspect `PLATFORM` balance, total commission, **صندوق ذخیره ریسک ضمانت ۵٪**, active Escrow, and per-branch dual-commission comparison.
   - **توسعه شهرها و نمایندگی‌ها**: launch/toggle cities and configure showroom partner branches & rate overrides.
   - **قوانین مشاوره هوشمند**: manage JSON-Logic rules live.
   - **تنظیمات داینامیک پلتفرم**: tune Surge cap (≤ ۱.۲۵), Urgency multipliers, Bundle tiers, Escrow split, and Dispatch scoring weights without redeploying.

## Repository Layout

```
├── prisma/            schema.prisma (23 models, PostGIS), seed.ts, migrations/
├── src/               NestJS modular monolith
│   ├── config/        Zod-validated typed AppConfig
│   ├── common/        guards (@Public/@Roles/@CurrentUser), filters, BigInt serializer
│   ├── infrastructure/ prisma (PostGIS), redis (GEO/Locks/PubSub/Patterns), realtime (WS /dispatch)
│   └── modules/
│       ├── admin-config, auth, users, cities-branches, notifications, wallet-escrow ← CORE (vertical-agnostic)
│       ├── health
│       └── security-services/                                          ← THE Phase-1 vertical
│           ├── catalog (schema-driven), advisory (JSON-Logic 3-pillar scoring)
│           ├── pricing (BigInt interpreter, surge/urgency/bundles)
│           ├── orders (12-state machine + escrow), dispatch (atomic lock waves)
│           ├── warranty (handover gate), reviews
├── web/               Next.js 14 App Router — RTL Persian schema-driven UI (+ web/Dockerfile)
├── ARCHITECTURE.md    17 locked invariants + module map + build order
├── Dockerfile         multi-stage Node 20 Alpine NestJS production image
└── docker-compose.yml postgis:16-3.4 + redis:7-alpine (+ fullstack profile for api & web)
```

## Scripts (backend root)

| Command | Purpose |
|---|---|
| `npm run build` / `lint` / `test` | 28 suites, 282 tests |
| `npm run prisma:generate` / `deploy` / `migrate` / `seed` | DB tooling |
| `npm run infra:up` / `down` | docker compose lifecycle |
| `npm run start:dev` | watch mode on :3000 |

## Scripts (web/)

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `lint` | Next.js on :3001 |

## Key Invariants (see ARCHITECTURE.md for the full 17)

- Money is **BigInt Toman**; surge/urgency apply ONLY to labor+dispatch, never hardware.
- 100% schema-driven: `uiSchema`, `pricingSchema`, `advisoryRules` live in PostgreSQL JSONB.
- Dispatch locking is **per-order** (`dispatch:order:lock:{id}`, SET NX PX + Lua release).
- Escrow split: platform commission + 5% warranty reserve, `Branch` overrides win.
- Handover gate: serials + privacy checklist + customer OTP → warranty + escrow, atomically.
