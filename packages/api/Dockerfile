FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/api/package.json ./packages/api/
COPY shared/package.json ./shared/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY . .
RUN pnpm -r build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/shared/package.json ./shared/
COPY pnpm-workspace.yaml package.json ./
RUN pnpm install --prod --frozen-lockfile
EXPOSE 3000
CMD ["node", "packages/api/dist/server.js"]
