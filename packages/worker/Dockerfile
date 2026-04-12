FROM node:20-alpine AS base
# GOTCHA G-006: Install FFmpeg + native build deps BEFORE npm install
RUN apk add --no-cache ffmpeg python3 make g++ vips-dev
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
# Copy all workspace manifests for proper dependency resolution
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/api/package.json ./packages/api/
COPY packages/worker/package.json ./packages/worker/
COPY shared/package.json ./shared/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build shared first (worker depends on it), then worker only
RUN pnpm --filter @media-hub/shared build
RUN pnpm --filter @media-hub/worker build

FROM node:20-alpine AS runner
RUN apk add --no-cache ffmpeg vips
WORKDIR /app
COPY --from=build /app/packages/worker/dist ./packages/worker/dist
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/packages/worker/package.json ./packages/worker/
COPY --from=build /app/shared/package.json ./shared/
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile
CMD ["node", "packages/worker/dist/worker.js"]
