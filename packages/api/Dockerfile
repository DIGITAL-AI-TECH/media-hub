FROM node:20-alpine AS base
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
# Build shared first (api depends on it), then api only
RUN pnpm --filter @media-hub/shared build
RUN pnpm --filter @media-hub/api build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/shared/package.json ./shared/
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile
EXPOSE 3000
CMD ["node", "packages/api/dist/server.js"]
