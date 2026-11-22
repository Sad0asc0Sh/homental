# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

FROM deps AS builder
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS prod-deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
  && npm install --no-save prisma@6.6.0 ts-node@10.9.2 typescript@5.7.3 @types/node@22.10.0 \
  && ./node_modules/.bin/prisma generate \
  && npm cache clean --force

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S homental && adduser -S homental -G homental

COPY --from=prod-deps --chown=homental:homental /app/node_modules ./node_modules
COPY --chown=homental:homental package.json tsconfig.json ./
COPY --from=builder --chown=homental:homental /app/dist ./dist
COPY --chown=homental:homental prisma ./prisma

USER homental
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
