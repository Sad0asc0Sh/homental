# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/customer/package.json ./apps/customer/package.json
COPY apps/partners/package.json ./apps/partners/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/device-bridge/package.json ./packages/device-bridge/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/scripts ./apps/api/scripts
RUN npm ci --workspace=apps/api --include-workspace-root \
  && ./node_modules/.bin/prisma generate --schema=apps/api/prisma/schema.prisma

FROM deps AS builder
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json ./apps/api/
COPY apps/api/src ./apps/api/src
RUN npm run build --workspace=apps/api

FROM node:20-alpine AS prod-deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/customer/package.json ./apps/customer/package.json
COPY apps/partners/package.json ./apps/partners/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/device-bridge/package.json ./packages/device-bridge/package.json
COPY apps/api/prisma ./apps/api/prisma
RUN npm ci --omit=dev --workspace=apps/api --include-workspace-root \
  && npm install --no-save prisma@6.6.0 ts-node@10.9.2 typescript@5.7.3 @types/node@22.10.0 \
  && ./node_modules/.bin/prisma generate --schema=apps/api/prisma/schema.prisma \
  && npm cache clean --force

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S homental && adduser -S homental -G homental

COPY --from=prod-deps --chown=homental:homental /app/node_modules ./node_modules
COPY --chown=homental:homental package.json tsconfig.base.json ./
COPY --chown=homental:homental apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY --from=builder --chown=homental:homental /app/apps/api/dist ./apps/api/dist
COPY --chown=homental:homental apps/api/prisma ./apps/api/prisma

WORKDIR /app/apps/api
USER homental
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
