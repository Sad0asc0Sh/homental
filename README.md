# Homental — npm Workspaces Monorepo (Security & Peace-of-Mind Platform)

Production-grade **NestJS Modular Monolith** backend + dual **Next.js 14 RTL Persian**
frontends (`هومنتال` for customers & `هومنتال همکاران` for partners/staff) backed by shared
workspace packages. Phase 1 pilot: Smart Security Advisor & Snapp-like Dispatch in
**Mashhad** — designed to scale into a multi-city Super-App without rewriting the core.

## Workspace Architecture & Local Ports

| Workspace | Package | Role | Local Port |
|---|---|---|---|
| `apps/api` | `@homental/api` | NestJS + Prisma Modular Monolith API (`/api/v1`, `/docs`, `/health`, `/dispatch` WS) | `3000` |
| `apps/customer` | `@homental/customer` | Customer RTL Persian app (**«هومنتال»**) — auth storage `homental-customer-auth` | `3001` |
| `apps/partners` | `@homental/partners` | Role-gated Partner & Staff RTL Persian app (**«هومنتال همکاران»**) — auth storage `homental-partners-auth` | `3002` |
| `packages/shared` | `@homental/shared` | Shared domain/partner types, `UserRole` metadata, order states, Persian formatters, icons | — |
| `packages/api-client` | `@homental/api-client` | Typed `/api/v1` fetch client, single-flight refresh rotation, Socket.io hook, auth store factory | — |
| `packages/device-bridge` | `@homental/device-bridge` | Zero-dependency Capacitor/Web platform & hardware capability interfaces | — |

## Quick Start

### Option A: Local Development (Infra in Docker, Apps via npm workspaces)

#### 1. Install Dependencies & Start Infrastructure (PostgreSQL+PostGIS & Redis)

```bash
npm install
npm run infra:up              # postgis/postgis:16-3.4 on :5432, redis:7-alpine on :6379
```

#### 2. Configure & Start Backend (`apps/api` — `http://localhost:3000`)

```bash
cp .env.example .env          # DATABASE_URL, REDIS_URL, JWT secrets, CORS_ORIGINS, OTP_DEV_ECHO=true (dev)
npm run prisma:generate
npm run prisma:deploy         # apply all 4 migrations (schema + PostGIS triggers/indexes)
npm run prisma:seed           # Mashhad city, branch, technicians, sellers, service schemas, advisory rules
npm run dev:api               # API on http://localhost:3000 — Swagger at /docs — health at /health
```

#### 3. Start Customer & Partners Frontends (`:3001` & `:3002`)

```bash
cp apps/customer/.env.example apps/customer/.env.local
cp apps/partners/.env.example apps/partners/.env.local

npm run dev:customer          # Customer app «هومنتال» on http://localhost:3001
npm run dev:partners          # Partners/Staff app «هومنتال همکاران» on http://localhost:3002
```

### Option B: One-Command Full-Stack Docker (`postgres` + `redis` + `api` + `customer` + `partners`)

```bash
# Production mode (OTP_DEV_ECHO=false by default):
docker compose --profile fullstack up --build -d

# Seed initial Mashhad data inside the running api container:
docker compose --profile fullstack exec api sh -c "/app/node_modules/.bin/prisma db seed"
```

> To run the local OTP demo inside Docker without an SMS provider, pass
> `NODE_ENV=development OTP_DEV_ECHO=true docker compose --profile fullstack up --build -d`
> (Zod blocks `OTP_DEV_ECHO=true` whenever `NODE_ENV=production`).

Open **http://localhost:3001** («هومنتال») → choose a location (Path 1) or browse the 3 engineering
pillars (Path 2) → configure services (schema-driven) → watch the live readiness meter &
price range → review the Smart Brief → login with phone OTP (dev code echoed in dev mode)
→ register an address → **ثبت پرونده امنیتی و اعزام کارشناس**.

With `OTP_DEV_ECHO=true` (dev only), login codes and handover OTPs are echoed in API
responses — Zod fails fast if enabled in production.

## Demo Walkthrough — Five-Role Mashhad Pilot Across Both Apps

Because `apps/customer` (`:3001`, key `homental-customer-auth`) and `apps/partners`
(`:3002`, key `homental-partners-auth`) run on separate ports with parameterized auth
storage keys, you can keep a customer session open on `:3001` simultaneously alongside
a partner/admin session on `:3002` (use separate browser profiles if testing multiple
partner roles simultaneously on `:3002`).

Seed data (after `npm run prisma:seed`) contains these Mashhad pilot phone numbers
(both canonical `+989...` and local `09...` formats work, with `devCode` echoed in dev mode):

| Role | App | Phone (local form) | Notes |
|---|---|---|---|
| Customer | `localhost:3001` | `+989120000020` (`09120000020`, سارا محمدی) | Wallet pre-charged ۵۰٬۰۰۰٬۰۰۰ تومان |
| Technician 1 | `localhost:3002` | `+989120000010` (`09120000010`, امیر کریمی) | ALARM + CCTV, rating ۴.۸ → `/technician` |
| Technician 2 | `localhost:3002` | `+989120000011` (`09120000011`, رضا احمدی) | ELECTRIC_SHUTTER + PARKING_JACK, rating ۴.۶ → `/technician` |
| Technician 3 | `localhost:3002` | `+989120000012` (`09120000012`, مهدی نوری) | All 4 skills, rating ۴.۹ → `/technician` |
| Seller | `localhost:3002` | `+989120000030` (`09120000030`, تأمین تجهیزات امنیتی مشهد) | CCTV offers, inbound shipments, supplier cases, wallet → `/seller` |
| Mashhad Branch Admin | `localhost:3002` | `+989120000002` (`09120000002`, حسین رضایی) | شعبه مرکزی مشهد — ۱۰٪ commission override → `/branch` |
| Super Admin | `localhost:3002` | `+989120000001` (`09120000001`, مدیر سامانه) | Full platform control & finance reserve dashboard → `/admin` |

1. **Technician (`http://localhost:3002`)**: login on `/` (redirects automatically to `/technician`)
   → pick **وکیل‌آباد** preset → toggle **آنلاین** so the tech is registered in Redis GEO and
   ready for live Socket.io dispatch offers.
2. **Customer (`http://localhost:3001`)**: open `/` → pick «فروشگاه / مغازه» → apply the one-click
   advisory («+ اعمال پیشنهاد») → continue to `/brief` → choose urgency «فوری» → login with OTP →
   set the package slider → register a Mashhad address → **ثبت پرونده امنیتی و اعزام کارشناس**.
   The invoice funds escrow at submit and `/order/[id]` shows the hold and dispatch status.
3. **Technician (`http://localhost:3002/technician`)**: the live offer card appears with a 30-second
   countdown (losing techs receive `OFFER_TAKEN` and dismiss immediately) → click **پذیرش سفارش**,
   then **شروع حرکت** → **رسیدم / شروع کارشناسی** → **تأیید تطابق محل و شروع کار**.
4. **Technician & Customer**: the technician records actual cable and duct measurements with
   photo references on `/technician`. Lower usage refunds the difference automatically. If usage
   is higher, the customer approves the difference in `http://localhost:3001/order/[id]` and
   charges the exact wallet shortfall.
5. **Technician (`http://localhost:3002/technician`)**: after metered reconciliation, enter the
   required hardware serial numbers, check both mandatory privacy checklist boxes, and select
   **صدور کد تحویل (OTP) برای مشتری** (`devHandoverOtp` shown in dev mode) → enter the 6-digit
   SMS code → **تکمیل تحویل، فعال‌سازی ضمانت و تسویه**.
6. **Customer (`http://localhost:3001`)**: `/warranties` displays the new `WR-YYYY-XXXXXX` Digital
   Warranty Certificate card (`daysRemaining` + serials) → submit a test claim (**ثبت تیکت خرابی ضمانت**);
   on `/order/[id]` submit a 1–5 star review, and review personal postings on `/wallet`.
7. **Branch Admin (`http://localhost:3002/branch`)**:
   - **صف سفارش‌ها**: filter `BRANCH_QUEUE` and send a five-minute invitation to an approved technician.
   - **مدیریت تکنسین‌ها**: view skills/rating/claim rate/online status, approve/suspend, or add a technician.
   - **رسیدگی به تیکت‌های ضمانت**: update claim status (`IN_REVIEW` / `APPROVED` / `RESOLVED` / `REJECTED`) with `resolutionNoteFa`.
8. **Super Admin (`http://localhost:3002/admin`)**:
   - **داشبورد مالی و صندوق ۵٪ ضمانت**: inspect `PLATFORM` balance, `restrictedReserve`, `restrictedFulfillment`, active Escrow, and per-branch dual-commission comparison.
   - **توسعه شهرها و نمایندگی‌ها**: launch/toggle cities and configure showroom partner branches & rate overrides.
   - **قوانین مشاوره هوشمند**: manage JSON-Logic rules live.
   - **تنظیمات داینامیک پلتفرم**: tune Surge cap (≤ ۱.۲۵), Urgency multipliers, Bundle tiers, Escrow split, and Dispatch scoring weights without redeploying.
9. **Technician Procurement (`http://localhost:3002/technician/supply`)**: add a CCTV item to the
   cart, review the partner price and bike/car estimate, then fund the order from the technician wallet.
10. **Seller (`http://localhost:3002/seller`)**: mark shipments dispatched and confirm delivery;
    handle technician returns, exchanges, repairs, and technical guidance in the after-sales tab.

## Repository Layout

```
├── package.json                  npm workspaces root scripts
├── tsconfig.base.json            Shared strict TypeScript baseline
├── docker-compose.yml            postgres + redis (+ fullstack: api, customer, partners)
├── ARCHITECTURE.md               17 locked invariants + monorepo module map
├── apps/
│   ├── api/                      NestJS + Prisma Modular Monolith (:3000)
│   │   ├── prisma/               schema.prisma (PostGIS), seed.ts, 4 migrations
│   │   ├── src/                  config, common, infrastructure, core + vertical modules
│   │   ├── test/                 E2E & architectural boundary tests
│   │   └── Dockerfile            Multi-stage Node 20 Alpine NestJS production image
│   ├── customer/                 Next.js 14 App Router — Customer RTL Persian UI «هومنتال» (:3001)
│   └── partners/                 Next.js 14 App Router — Role-gated Partner & Staff UI «هومنتال همکاران» (:3002)
└── packages/
    ├── shared/                   @homental/shared
    ├── api-client/               @homental/api-client
    └── device-bridge/            @homental/device-bridge
```

## Workspace Commands (Root)

| Command | Purpose |
|---|---|
| `npm run dev:api` / `dev:customer` / `dev:partners` | Start API (`:3000`), Customer (`:3001`), or Partners (`:3002`) in dev mode |
| `npm run build:api` / `build:customer` / `build:partners` / `build:all` | Production builds per app or all apps |
| `npm run lint:api` / `lint:customer` / `lint:partners` / `lint:all` | ESLint across workspaces |
| `npm run typecheck:packages` | Run `tsc --noEmit` across `packages/*` |
| `npm run test:api` | Run all 38 Jest suites sequentially (`--runInBand`) in `apps/api` |
| `npm run prisma:validate` / `generate` / `migrate` / `deploy` / `seed` | Prisma CLI targeting `apps/api/prisma/schema.prisma` |
| `npm run infra:up` / `down` | PostgreSQL+PostGIS & Redis Docker lifecycle |

## Key Invariants (see ARCHITECTURE.md for the full 17)

- Money is **BigInt Toman**; surge/urgency apply ONLY to labor+dispatch, never hardware.
- 100% schema-driven: `uiSchema`, `pricingSchema`, `advisoryRules` live in PostgreSQL JSONB.
- Dispatch locking is **per-order** (`dispatch:order:lock:{id}`, SET NX PX + Lua release).
- Managed escrow (Phase 11A–11C): three-part invoice funded at submit, zero-markup `partnerPrice` hardware pass-through (`sellerAppFeeFlat` default 0 in Mashhad), strict `500 bps` (5%) warranty reserve on realized `SERVICE_PACKAGE` isolated in `restrictedReserve`, freight in `restrictedFulfillment`, confidential platform commission, and `Branch` rate overrides winning over `PlatformConfig['escrow.split']`.
- Handover gate: serials + privacy checklist + customer OTP → warranty + escrow, atomically.
