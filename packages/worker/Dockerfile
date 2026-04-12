FROM node:20-alpine AS base
# GOTCHA G-006: Install FFmpeg + native build deps BEFORE npm install
RUN apk add --no-cache ffmpeg python3 make g++ vips-dev
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/worker/package.json ./packages/worker/
COPY shared/package.json ./shared/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY . .
RUN pnpm -r build

FROM node:20-alpine AS runner
RUN apk add --no-cache ffmpeg vips
WORKDIR /app
COPY --from=build /app/packages/worker/dist ./packages/worker/dist
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/packages/worker/package.json ./packages/worker/
COPY --from=build /app/shared/package.json ./shared/
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
CMD ["node", "packages/worker/dist/worker.js"]
