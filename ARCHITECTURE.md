# Homental — Architecture & Non-Negotiable Invariants

> This document is the contract for Tasks 2–6. No implementation may drift from
> the invariants below without a schema/architecture review.

## 1. What Homental is

A production-grade **Modular Monolith** (NestJS, strict TypeScript) starting as a
Smart Security Advisor & Snapp-like dispatch platform in **Mashhad**, designed to
grow into a multi-city Super-App (branches, verified second-hand goods, hourly
space booking) **without rewriting the core**.

- Backend: NestJS (strict TS) — modular monolith with shared core + vertical modules
- Database: PostgreSQL 16 + PostGIS, Prisma ORM (BigInt money, JSONB schemas)
- Runtime geo/concurrency: Redis 7 (GEO, Pub/Sub, atomic per-order locks) + Socket.io
- Rules: JSON-Logic documents in PostgreSQL (decoupled from application code)
- Frontend (later): Next.js RTL Persian UI consuming JSON schemas from this backend

## 2. Locked invariants

| # | Invariant |
|---|-----------|
| 1 | **Money is BigInt Toman.** Never floats. `Decimal` (Prisma) is allowed only for rates/multipliers. Wallet mutations are signed ledger entries with `balanceAfter` snapshots and unique `idempotencyKey`s. |
| 2 | **Surge & urgency multipliers apply ONLY to labor + dispatch costs — never to hardware.** Enforced by `pricingSchema.multipliersApplyTo`. Surge is capped at `1.25` (trust cap); urgency map: `SCHEDULED 1.0 / SAME_DAY 1.12 / EMERGENCY 1.3` (from `PlatformConfig['pricing.urgency']`). |
| 3 | **100% schema-driven catalog.** Service inputs (`uiSchema`), pricing (`pricingSchema`) and advisory rules live in PostgreSQL JSONB. All customer-facing copy is natural Persian (`fa`) stored in data — never hard-coded in code. Code identifiers are English. |
| 4 | **JSON-Logic dialect:** the pricing/advisory evaluator must support (register) `ceil` and `max`. `max` clamps quantities at zero (e.g. extra remotes: `{ max: [0, { '-': [{ var: 'remoteCount' }, 1] }] }`) so a formula can never SUBTRACT from a quote. |
| 5 | **Dispatch locking is per-order.** One atomic Redis key `dispatch:order:lock:{orderId}` (`SET key token NX PX ttlMs`) — two technicians with parallel offers for the same order can never both acquire it. Release is a token-scoped Lua compare-and-delete; a holder can never release someone else's lock. Offer TTL: 30s (`dispatch.offer.ttlSeconds`). |
| 6 | **Escrow split:** platform commission (default 15%) + 5% warranty reserve (dedicated ledger). `Branch.commissionRateOverride` / `Branch.warrantyReserveOverride` win when set (dual-commission model: partner branches with `hasPhysicalShowroom = true` get reduced rates); `null` falls back to `PlatformConfig['escrow.split']`. |
| 7 | **Per-item `supplyMode`** on `OrderItem` (`null` = inherit `ServiceOrder.supplyMode`) so a bundle can mix `INSTALL_ONLY` (own CCTV) + `FULL_PACKAGE` (new alarm). Hardware lines are dropped for `INSTALL_ONLY` items; labor/dispatch still apply. |
| 8 | **Strict 12-state order machine:** `DRAFT → ESTIMATED → SEARCHING_EXPERT → EXPERT_ASSIGNED → ON_THE_WAY → INSPECTING → QUOTE_APPROVED → IN_PROGRESS → HANDOVER_OTP_PENDING → COMPLETED_WARRANTY_ACTIVE` (+ `CANCELLED`, `BRANCH_QUEUE`). Transitions are validated against an explicit allowed-transition map and written to the append-only `OrderStateTransition` audit log. |
| 9 | **Handover gate (all three mandatory):** hardware serials registered → privacy checklist signed (default passwords changed & technician access revoked) → customer handover OTP verified. Completing the gate atomically activates the Digital Warranty **and** releases Escrow. |
| 10 | **Geo:** `Decimal` lat/lng are the source of truth in PostgreSQL; `geography(Point,4326)` columns are mirrors maintained by `BEFORE INSERT OR UPDATE` triggers. Runtime geo-matching (dispatch zones) lives in Redis GEO, keyed per city (`homental:geo:technicians:{citySlug}`). |
| 11 | **Multi-city ready:** every Redis key, dispatch zone and branch is city/branch-scoped; core modules (`auth`, `cities-branches`, `wallet-escrow`, `notifications`) never import vertical modules. Verticals may import core. |
| 12 | **Config is validated at startup with Zod** (`src/config`) — fail fast with readable errors. No `process.env` access outside `src/config`. |
| 13 | **BigInt/Decimal never cross the HTTP boundary raw** — `BigIntSerializerInterceptor` converts BigInt → string, Decimal → number, so `JSON.stringify` can never crash. Pub/Sub payloads use the same BigInt-safe replacer. |
| 14 | **Pricing/advisory rule payloads are data, not code.** No `if (service === 'CCTV')` in engines; engines only interpret schemas/rules. |
| 15 | **Auth session security:** refresh tokens are JWTs signed with `JWT_REFRESH_SECRET` whose `jti` maps to a `RefreshSession` row (SHA-256 hash stored, never the raw token). Strict rotation on every refresh; replaying a revoked token revokes ALL of the user's sessions (reuse detection). OTP codes are scrypt-hashed with per-code random salt; Redis rate limits: 1/minute + 5/hour per phone. |
| 16 | **RBAC scoping:** `BRANCH_ADMIN` is always locked to `AuthenticatedUser.branchId` — technicians, branches and future branch-scoped resources enforce it in the SERVICE layer (not only the guard), and commission/warranty overrides are SUPER_ADMIN-only. |
| 17 | **NestJS DI discipline:** constructor-injected classes MUST be value imports — `import type` erases `design:paramtypes` and breaks runtime DI. The rule `@typescript-eslint/consistent-type-imports` stays disabled; `src/common/di-smoke.spec.ts` is the regression guard. |

## 3. Module map

```
src/
├── config/           Zod-validated typed AppConfig (global)
├── common/           decorators, guards, filters, interceptors, utils (global concerns)
├── infrastructure/   prisma/ (PostgreSQL+PostGIS), redis/ (GEO, locks, pub/sub), realtime/ (Socket.io — Task 6)
├── modules/
│   ├── health/       GET /health (PostgreSQL+PostGIS & Redis)
│   ├── auth/         phone-OTP, JWT access/refresh, RBAC (Task 2)
│   ├── users/        profiles & addresses (Task 2)
│   ├── cities-branches/ (Task 2)
│   ├── wallet-escrow/ (Task 5)
│   ├── notifications/ (Task 2 core, Task 6 realtime)
│   └── security-services/   THE Phase-1 vertical
│       ├── catalog/    schema-driven service definitions (Task 3)
│       ├── advisory/   JSON-Logic readiness engine, 0–100 scores, max 2 suggestions (Task 3)
│       ├── pricing/    pricing-schema interpreter, surge/urgency, bundles (Task 4)
│       ├── orders/     state machine + escrow triggers (Task 5)
│       ├── dispatch/   Redis GEO expanding radius, weighted scoring, 30s offers (Task 6)
│       ├── warranty/   activation/claims/reserve release (Task 6)
│       └── reviews/    ratings feeding dispatch scoring (Task 6)
```

**Dependency rule:** `infrastructure` → `config` → `common`; `modules/*` may
import core modules + infrastructure; **core modules never import verticals**.

## 4. Build order (locked)

- Task 1 — Scaffold & shared infrastructure ✅
- Task 2 — Auth, RBAC & org ✅ (phone-OTP login w/ Redis rate limits, JWT access + refresh rotation with reuse-detection revocation, `@Public`/`@Roles`/`@CurrentUser` + `JwtAuthGuard`/`RolesGuard`, users & addresses, branch-scoped admin technicians, cities/branches admin CRUD with role-restricted fields, notifications core + pluggable SMS provider)
- Task 3 — Catalog & Advisory engine ✅ (`GET /api/v1/catalog/schemas` grouped under the 3 pillars w/ Persian metadata + `recommendedPreset` dual-path entry, `locationType` filtering of fields/goal-cards, admin CRUD with Zod-validated JSONB + auto version bump; `POST /api/v1/advisor/evaluate` guest engine: facts builder merges `pricingSchema.variables` defaults under user answers, location-weighted 0–100 pillar scoring w/ Persian tiers, JSON-Logic rule engine (max 2, priority-ordered, one-click `APPLY_SERVICE_CONFIG`), customer SecurityProfiles, admin rules CRUD with `validateLogic` dry-run)
- Task 4 — Dynamic pricing engine (interpreter, supplyMode, surge, urgency, bundles, transparent breakdown)
- Task 5 — Orders, state machine & escrow (transitions, audit, escrow hold/release, BRANCH_QUEUE)
- Task 6 — Dispatch, realtime & warranty lock (GEO sync, weighted scoring, 30s offers + locks, handover gate, reviews, e2e)

## 5. Verification bar

Every task ends with: `prisma validate` ✅, `npm run build` ✅, `npm run lint` ✅,
`npm test` ✅, and (when infra is available) `prisma migrate` + seed idempotency +
`GET /health`.
