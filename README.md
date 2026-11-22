# Homental — Modular Monolith for Security & Peace-of-Mind Services

Production-grade **NestJS Modular Monolith** backend + **Next.js RTL Persian** schema-driven
frontend. Phase 1 pilot: Smart Security Advisor & Snapp-like Dispatch in **Mashhad** —
designed to scale into a multi-city Super-App without rewriting the core.

## Quick Start (Backend + Frontend together)

### 1. Infrastructure (PostgreSQL+PostGIS & Redis)

```bash
docker compose up -d          # postgis/postgis:16-3.4 on :5432, redis:7-alpine on :6379
```

### 2. Backend (NestJS — http://localhost:3000)

```bash
npm install
cp .env.example .env          # DATABASE_URL, REDIS_URL, JWT secrets, OTP_DEV_ECHO=true (dev)
npm run prisma:deploy         # apply migrations (schema + PostGIS triggers/indexes)
npm run prisma:seed           # Mashhad city, branch, technicians, 4 service schemas, 7 advisory rules
npm run start:dev             # API on http://localhost:3000 — Swagger at /docs — health at /health
```

### 3. Frontend (Next.js — http://localhost:3001)

```bash
cd web
npm install
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
npm run dev                   # RTL Persian UI on http://localhost:3001
```

Open **http://localhost:3001** → choose a location (Path 1) or browse the 3 engineering
pillars (Path 2) → configure services (schema-driven) → watch the live readiness meter &
price range → review the Smart Brief → login with phone OTP (dev code echoed in dev mode)
→ register an address → **ثبت پرونده امنیتی و اعزام کارشناس**.

With `OTP_DEV_ECHO=true` (dev only), login codes and handover OTPs are echoed in API
responses — Zod fails fast if enabled in production.

## Demo Walkthrough — full 3-role Mashhad loop in ~5 minutes

Seed data (after `npm run prisma:seed`) contains these phone numbers (login = phone OTP,
code echoed in dev mode as `devCode`):

| Role | Phone | Notes |
|---|---|---|
| Customer | `09120000020` (سارا محمدی) | wallet pre-charged ۵۰٬۰۰۰٬۰۰۰ تومان |
| Technician 1 | `09120000010` (امیر کریمی) | ALARM + CCTV, rating ۴.۹ |
| Technician 2 | `09120000011` (رضا احمدی) | SHUTTER + JACK, rating ۴.۶ |
| Technician 3 | `09120000012` (مهدی نوری) | all skills, rating ۴.۹ |
| Branch Admin | `09120000002` (حسین رضایی) | شعبه مرکزی مشهد — ۱۰٪ commission override |

Steps (use **two browser windows** — one customer, one technician):

1. **Customer**: login at `/brief` → pick «فروشگاه / مغازه» → apply the one-click
   advisory («+ اعمال پیشنهاد») → urgency «فوری» → register address → ثبت پرونده.
2. **Technician**: login at `/technician` → pick وکیل‌آباد preset → toggle **آنلاین** →
   the live offer card appears with a 30-second countdown → **پذیرش سفارش**.
3. **Customer** (order page, live via Socket.io): watch timeline advance → در
   `INSPECTING` the escrow approval card appears → **تأیید قیمت و پرداخت امن**.
4. **Technician**: «شروع نصب و اجرا» → register hardware serials → check BOTH privacy
   checklist boxes → صدور کد تحویل → enter the customer's SMS code → **تکمیل تحویل**.
5. **Customer**: warranty card appears at `/warranties` → submit a claim → **Branch
   Admin** at `/branch` → Tab تیکت‌های ضمانت → approve it → back to customer's warranty
   card shows ACTIVE again. Submit a review on the order page (updates dispatch scoring).
6. **Branch Admin**: Tab صف سفارش‌ها — if dispatch found no technician (order in
   «در صف شعبه»), assign one manually; Tab تکنسین‌ها — approve/suspend/add technicians.

## Repository Layout

```
├── prisma/            schema.prisma (23 models, PostGIS), seed.ts, migrations/
├── src/               NestJS modular monolith
│   ├── config/        Zod-validated typed AppConfig
│   ├── common/        guards (@Public/@Roles/@CurrentUser), filters, BigInt serializer
│   ├── infrastructure/ prisma (PostGIS), redis (GEO/Locks/PubSub/Patterns), realtime (WS /dispatch)
│   └── modules/
│       ├── auth, users, cities-branches, notifications, wallet-escrow   ← CORE (vertical-agnostic)
│       ├── health
│       └── security-services/                                          ← THE Phase-1 vertical
│           ├── catalog (schema-driven), advisory (JSON-Logic 3-pillar scoring)
│           ├── pricing (BigInt interpreter, surge/urgency/bundles)
│           ├── orders (12-state machine + escrow), dispatch (atomic lock waves)
│           ├── warranty (handover gate), reviews
├── web/               Next.js 14 App Router — RTL Persian schema-driven UI
├── ARCHITECTURE.md    17 locked invariants + module map + build order
└── docker-compose.yml postgis:16-3.4 + redis:7-alpine (healthchecks)
```

## Scripts (backend root)

| Command | Purpose |
|---|---|
| `npm run build` / `lint` / `test` | 27 suites, 273 tests |
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
