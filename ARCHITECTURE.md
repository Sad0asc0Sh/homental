# Homental — Architecture & Non-Negotiable Invariants

> This document is the contract for Homental. No implementation may drift from
> the invariants below without a schema/architecture review.

## 1. What Homental is

A production-grade **npm workspaces Monorepo** (NestJS + Prisma Modular Monolith API
+ two Next.js 14 RTL Persian frontends + shared packages) starting as a Smart Security
Advisor & Snapp-like dispatch platform in **Mashhad**, designed to grow into a
multi-city Super-App (branches, verified second-hand goods, hourly space booking)
**without rewriting the core**.

- Backend (`apps/api`): NestJS (strict TS) — modular monolith with shared core + vertical modules on port `3000`
- Customer Frontend (`apps/customer`): Next.js 14 RTL Persian app («هومنتال») on port `3001` — advisor, configurator, brief, orders, warranties, customer wallet
- Partners & Staff Frontend (`apps/partners`): Next.js 14 RTL Persian app («هومنتال همکاران») on port `3002` — role-gated portals for technicians (`TECHNICIAN`), sellers (`SELLER`), branch admins (`BRANCH_ADMIN`), and super admins (`SUPER_ADMIN`)
- Shared Packages (`packages/*`):
  - `packages/shared` (`@homental/shared`): domain & partner-supply types, role metadata, 12-state order metadata, Persian formatters, schema icon mappings
  - `packages/api-client` (`@homental/api-client`): typed `/api/v1` HTTP client with single-flight refresh rotation, `/dispatch` Socket.io hook, parameterized Zustand auth store factory (per-app `storageKey`)
  - `packages/device-bridge` (`@homental/device-bridge`): SSR-safe platform abstraction (`web` / `android-capacitor` / `ios-capacitor`) with camera, geolocation, push, and 3D space-scanner capability hooks
- Database: PostgreSQL 16 + PostGIS, Prisma ORM (BigInt money, JSONB schemas)
- Runtime geo/concurrency: Redis 7 (GEO, Pub/Sub, atomic per-order locks) + Socket.io
- Rules: JSON-Logic documents in PostgreSQL (decoupled from application code)

## 2. Locked invariants

| # | Invariant |
|---|-----------|
| 1 | **Money is BigInt Toman.** Never floats. `Decimal` (Prisma) is allowed only for rates/multipliers. Wallet mutations are signed ledger entries with `balanceAfter` snapshots and unique `idempotencyKey`s. |
| 2 | **Surge & urgency multipliers apply ONLY to labor + dispatch costs — never to hardware.** Enforced by `pricingSchema.multipliersApplyTo`. Surge is capped at `1.25` (trust cap); urgency map: `SCHEDULED 1.0 / SAME_DAY 1.12 / EMERGENCY 1.3` (from `PlatformConfig['pricing.urgency']`). |
| 3 | **100% schema-driven catalog.** Service inputs (`uiSchema`), pricing (`pricingSchema`) and advisory rules live in PostgreSQL JSONB. All customer-facing copy is natural Persian (`fa`) stored in data — never hard-coded in code. Code identifiers are English. |
| 4 | **JSON-Logic dialect:** the pricing/advisory evaluator must support (register) `ceil` and `max`. `max` clamps quantities at zero (e.g. extra remotes: `{ max: [0, { '-': [{ var: 'remoteCount' }, 1] }] }`) so a formula can never SUBTRACT from a quote. |
| 5 | **Dispatch locking is per-order.** One atomic Redis key `dispatch:order:lock:{orderId}` (`SET key token NX PX ttlMs`) — two technicians with parallel offers for the same order can never both acquire it. Release is a token-scoped Lua compare-and-delete; a holder can never release someone else's lock. Offer TTL: 30s (`dispatch.offer.ttlSeconds`). |
| 6 | **Managed escrow, reserve isolation & confidential splits (Phase 11A–11C):** Managed service orders (`pricingVersion = 2`) produce a three-part invoice (`FIXED`, `SERVICE_PACKAGE`, `METERED`) funded into escrow (`EscrowPosition`) at order submit. Hardware is passed through at zero markup from `SellerOffer.partnerPrice` (with sellers paying only flat `SellerProfile.sellerAppFeeFlat`, default `0` Toman in Mashhad). At settlement, a strict `500 bps` (5%) warranty reserve is computed **solely on the realized `SERVICE_PACKAGE` amount** and credited to the `PLATFORM` wallet's isolated `restrictedReserve` balance (`WARRANTY_RESERVE`), while B2C/B2B freight allocations are credited to the `PLATFORM` wallet's isolated `restrictedFulfillment` balance (`FULFILLMENT_ALLOCATION`). Platform commission lives confidentially inside `SERVICE_PACKAGE` protected-floor / bargaining-slider economics (never leaked to non-`SUPER_ADMIN` roles); `Branch.commissionRateOverride` / `Branch.warrantyReserveOverride` win over `PlatformConfig['escrow.split']` defaults when set (`null` falls back to `PlatformConfig['escrow.split']`). |
| 7 | **Per-item `supplyMode`** on `OrderItem` (`null` = inherit `ServiceOrder.supplyMode`) so a bundle can mix `INSTALL_ONLY` (own CCTV) + `FULL_PACKAGE` (new alarm). Hardware lines are dropped for `INSTALL_ONLY` items; labor/dispatch still apply. |
| 8 | **Strict 12-state order machine:** `DRAFT → ESTIMATED → SEARCHING_EXPERT → EXPERT_ASSIGNED → ON_THE_WAY → INSPECTING → QUOTE_APPROVED → IN_PROGRESS → HANDOVER_OTP_PENDING → COMPLETED_WARRANTY_ACTIVE` (+ `CANCELLED`, `BRANCH_QUEUE`). Transitions are validated against an explicit allowed-transition map and written to the append-only `OrderStateTransition` audit log. |
| 9 | **Handover gate (all three mandatory):** hardware serials registered → privacy checklist signed (default passwords changed & technician access revoked) → customer handover OTP verified. Completing the gate atomically activates the Digital Warranty **and** releases Escrow. |
| 10 | **Geo:** `Decimal` lat/lng are the source of truth in PostgreSQL; `geography(Point,4326)` columns are mirrors maintained by `BEFORE INSERT OR UPDATE` triggers. Runtime geo-matching (dispatch zones) lives in Redis GEO, keyed per city (`homental:geo:technicians:{citySlug}`). |
| 11 | **Multi-city ready:** every Redis key, dispatch zone and branch is city/branch-scoped; core modules (`auth`, `users`, `cities-branches`, `wallet-escrow`, `notifications`, `properties`) never import vertical modules. Verticals may import core. |
| 12 | **Config is validated at startup with Zod** (`apps/api/src/config`) — fail fast with readable errors. No `process.env` access outside `apps/api/src/config`. |
| 13 | **BigInt/Decimal never cross the HTTP boundary raw** — `BigIntSerializerInterceptor` converts BigInt → string, Decimal → number, so `JSON.stringify` can never crash. Pub/Sub payloads use the same BigInt-safe replacer. |
| 14 | **Pricing/advisory rule payloads are data, not code.** No `if (service === 'CCTV')` in engines; engines only interpret schemas/rules. |
| 15 | **Auth session security:** refresh tokens are JWTs signed with `JWT_REFRESH_SECRET` whose `jti` maps to a `RefreshSession` row (SHA-256 hash stored, never the raw token). Strict rotation on every refresh; replaying a revoked token revokes ALL of the user's sessions (reuse detection). OTP codes are scrypt-hashed with per-code random salt; Redis rate limits: 1/minute + 5/hour per phone. |
| 16 | **RBAC scoping:** `BRANCH_ADMIN` is always locked to `AuthenticatedUser.branchId` — technicians, branches and future branch-scoped resources enforce it in the SERVICE layer (not only the guard), and commission/warranty overrides are SUPER_ADMIN-only. |
| 17 | **NestJS DI discipline:** constructor-injected classes MUST be value imports — `import type` erases `design:paramtypes` and breaks runtime DI. The rule `@typescript-eslint/consistent-type-imports` stays disabled in `apps/api`; `apps/api/src/common/di-smoke.spec.ts` is the regression guard. |

## 3. Module & Monorepo map

```
homental/
├── package.json                  npm workspaces coordinator (apps/*, packages/*)
├── tsconfig.base.json            Shared strict TypeScript baseline
├── docker-compose.yml            postgres + redis (+ fullstack profile: api, customer, partners)
├── apps/
│   ├── api/                      NestJS + Prisma modular monolith (:3000) + Dockerfile
│   │   ├── prisma/               schema.prisma (PostGIS), seed.ts, 5 migrations
│   │   ├── test/                 E2E & boundary regression suites
│   │   └── src/
│   │       ├── config/           Zod-validated typed AppConfig (global)
│   │       ├── common/           decorators, guards, filters, interceptors, utils
│   │       ├── infrastructure/   prisma (PostGIS), redis (GEO, locks, pub/sub), realtime (/dispatch)
│   │       └── modules/
│   │           ├── health/       GET /health (PostgreSQL+PostGIS & Redis)
│   │           ├── auth/         phone-OTP, JWT access/refresh, RBAC
│   │           ├── users/        profiles & addresses
│   │           ├── cities-branches/
│   │           ├── wallet-escrow/
│   │           ├── notifications/
│   │           ├── admin-config/
│   │           ├── properties/           saved properties, site media / spatial-ready metadata & MediaStorageProvider (Core)
│   │           ├── partner-supply/      B2B checkout, seller portal, and supplier after-sales
│   │           └── security-services/   THE Phase-1 vertical
│   │               ├── catalog/         schema-driven service definitions
│   │               ├── advisory/        JSON-Logic readiness engine, 0–100 scores, max 2 suggestions
│   │               ├── pricing/         managed pricing interpreter, surge/urgency, slider, bundles
│   │               ├── orders/          12-state machine, escrow at submit, metered adjustments
│   │               ├── dispatch/        Redis GEO priority/expanding waves, weighted scoring, 30s offers
│   │               ├── warranty/        activation/claims/reserve release
│   │               └── reviews/         ratings feeding dispatch scoring
│   ├── customer/                 Next.js 14 RTL Persian customer app «هومنتال» (:3001) + Dockerfile
│   └── partners/                 Next.js 14 RTL Persian partner/staff app «هومنتال همکاران» (:3002) + Dockerfile
└── packages/
    ├── shared/                   @homental/shared — domain/partner types, roles, order states, Persian formatters, icons
    ├── api-client/               @homental/api-client — HTTP client, Socket.io hook, parameterized Zustand auth store
    └── device-bridge/            @homental/device-bridge — Capacitor/Web platform & capability abstractions
```

**Backend dependency rule:** `infrastructure` → `config` → `common`; `modules/*` may
import core modules + infrastructure; **core modules never import verticals**.
`partner-supply` and `security-services` share inventory, escrow, and fulfillment
records through Prisma and the core wallet service. The two verticals have no
imports between them (enforced by `apps/api/test/phase11c-boundaries.spec.ts`).

## 4. Build order (locked)

- Task 1 — Scaffold & shared infrastructure ✅
- Task 2 — Auth, RBAC & org ✅ (phone-OTP login w/ Redis rate limits, JWT access + refresh rotation with reuse-detection revocation, `@Public`/`@Roles`/`@CurrentUser` + `JwtAuthGuard`/`RolesGuard`, users & addresses, branch-scoped admin technicians, cities/branches admin CRUD with role-restricted fields, notifications core + pluggable SMS provider)
- Task 3 — Catalog & Advisory engine ✅ (`GET /api/v1/catalog/schemas` grouped under the 3 pillars w/ Persian metadata + `recommendedPreset` dual-path entry, `locationType` filtering of fields/goal-cards AND `supportedLocationTypes` services, admin CRUD with Zod-validated JSONB + auto version bump; `POST /api/v1/advisor/evaluate` guest engine: facts builder merges `pricingSchema.variables` defaults under user answers, location-weighted 0–100 pillar scoring w/ gap-free completion bonus + Persian tiers, JSON-Logic rule engine (max 2, priority-ordered, one-click `APPLY_SERVICE_CONFIG`), customer SecurityProfiles, admin rules CRUD with `validateLogic` dry-run)
- Task 4 — Dynamic pricing engine ✅ (`POST /api/v1/pricing/estimate` guest endpoint + `includePricing` inside advisor/evaluate for the one-call Sticky Live Bar; `PricingSchemaInterpreter` handles all three unit-price forms w/ clamped quantities & per-item `supplyMode`; `DynamicFactorsService` reads `pricing.surge`/`pricing.urgency`/`pricing.bundleDiscount` from PlatformConfig — **supply/demand** surge (activeTechs/pendingOrders) clamped at the 1.25 trust cap w/ graceful 1.0 fallback; BigInt-only money, bundle tiers 6%/10%, hardware absolutely isolated from surge/urgency (hard-guarded), `estimatedMin/Max` rounded to 100k Toman)
- Task 5 — Orders, state machine & escrow ✅ (CORE `wallet-escrow` module: tx-composable `topUp`/`holdEscrow` (atomic overdraft guard)/`refundEscrow`/`releaseEscrowAndSplit` w/ zero-drift BigInt split, dual-commission branch overrides, derived idempotency keys, rate-sum ≤ 1 guard, loud PLATFORM-wallet errors; wallet endpoints. VERTICAL `orders`: explicit 12-state `ALLOWED_TRANSITIONS` map + optimistic guarded transitions + append-only `OrderStateTransition` audit; order creation persists BigInt-safe pricing snapshots + per-item supplyMode; role/branch-scoped reads; approve-quote holds escrow INSIDE the state transition; cancel from QUOTE_APPROVED refunds atomically; IN_PROGRESS+ not cancellable; BRANCH_QUEUE fallback)
- Task 6 — Dispatch, realtime & warranty lock ✅ **(PHASE 1 BACKEND COMPLETE)** — Realtime WS gateway `/dispatch` (JWT handshake, `user:{id}`/`order:{id}` rooms, permission-checked `join_order`, Redis `notifications:user:*` bridge for horizontal scaling); Dispatch engine (GEO status/location sync, pure weighted candidate scorer with neutral-70 rookie rating, expanding-radius waves 5000→12000→19000 w/ `maxParallelOffers`, 30s TTL offers, atomic single-winner accept behind the per-order `SET NX PX` lock + Lua release, decline/expiry sweeper, `BRANCH_QUEUE` fallback w/ `NO_TECHNICIAN_IN_RADIUS` audit + branch-admin notification); Mandatory Handover Gate (serials on FULL_PACKAGE items → privacy checklist → customer OTP, 3-attempt lock, scrypt+timingSafeEqual) atomically completing warranty (`WR-YYYY-XXXXXX`, per-item coverage, min months) + escrow release/split + `completedJobs` in ONE transaction; Warranty card/claims w/ claim-rate + rating feedback loops into dispatch scoring; verified by a 13-step end-to-end lifecycle suite
- Phase 11A — Managed pricing, three-part invoice, escrow at submit, shared seller inventory, and isolated warranty and fulfillment reserves ✅
- Phase 11B — Funded bargaining slider, priority-wave dispatch, and exact centimetre reconciliation with wallet recovery ✅
- Phase 11C — Technician procurement and seller portal. B2B and B2C draw on the same stock. B2B settles seller goods proceeds and restricted freight when the final shipment is delivered. Supplier cases support unused returns, exchanges, repairs, and technical guidance ✅
- Phase 12A — npm workspaces Monorepo migration (`apps/api`, `apps/customer`, `apps/partners`, `packages/shared`, `packages/api-client`, `packages/device-bridge`) ✅
- Phase 12B — Android-ready PWAs (`apps/customer` and `apps/partners` manifests, network-first safe Service Workers, mobile bottom nav bars, safe-area ergonomics) & thin Capacitor Android live-URL shell (`@homental/device-bridge`) ✅
- Phase 12C — Core `properties` module (`CustomerProperty` + `PropertyMediaAsset` with PostGIS trigger, spatial-ready `.glb`/floorplan metadata, injectable `MediaStorageProvider` presign/complete contract, optional `ServiceOrder.propertyId`, strict service-layer RBAC with zero `SELLER` access, customer `/properties` & `/brief` selector, read-only partner property cards) ✅
- Task 7+ — Phase 2 backlog (multi-city branches, verified second-hand goods, hourly space/cafe booking — reuse core modules as-is)

## 5. Verification bar

Every milestone ends with: `prisma:validate` ✅, `build:all` ✅, `lint:all` ✅,
`typecheck:packages` ✅, `test:api` ✅, and (when infra is available) `prisma:deploy` + seed idempotency (`seed ×2`) +
`GET /health`.
