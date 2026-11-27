# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/customer/package.json ./apps/customer/package.json
COPY apps/partners/package.json ./apps/partners/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/device-bridge/package.json ./packages/device-bridge/package.json
RUN npm ci --workspace=apps/partners --include-workspace-root

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/partners ./apps/partners
RUN mkdir -p apps/partners/public

ARG NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
ARG NEXT_PUBLIC_WS_URL=http://localhost:3000
ARG NEXT_PUBLIC_CUSTOMER_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_CUSTOMER_URL=$NEXT_PUBLIC_CUSTOMER_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build --workspace=apps/partners

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder /app/apps/partners/public ./apps/partners/public
COPY --from=builder --chown=nextjs:nextjs /app/apps/partners/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/apps/partners/.next/static ./apps/partners/.next/static

USER nextjs
EXPOSE 3002

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3002').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/partners/server.js"]
