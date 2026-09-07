# syntax=docker/dockerfile:1
# M-UI 静态构建镜像：SvelteKit adapter-static 产物由 Bun-only 静态服务器托管。
# BFF 地址在构建期通过 VITE_MERISTEM_MUI_BFF_URL 烧入，部署到不同域名时需重新构建。
ARG BUN_VERSION=1

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/m-ui/package.json apps/m-ui/package.json
COPY apps/core/package.json apps/core/package.json
COPY apps/m-cli/package.json apps/m-cli/package.json
COPY services/m-net/package.json services/m-net/package.json
COPY services/m-policy/package.json services/m-policy/package.json
COPY services/m-log/package.json services/m-log/package.json
COPY services/m-eventbus/package.json services/m-eventbus/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/events/package.json packages/events/package.json
COPY packages/internal-http/package.json packages/internal-http/package.json
COPY packages/policy/package.json packages/policy/package.json
COPY packages/secrets/package.json packages/secrets/package.json
COPY packages/telemetry/package.json packages/telemetry/package.json
COPY packages/testing/package.json packages/testing/package.json
# --ignore-scripts 跳过根 prepare（git hooks 安装在构建容器内无意义）
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.json tsconfig.base.json ./
COPY apps/m-ui ./apps/m-ui
ARG VITE_MERISTEM_MUI_BFF_URL=http://localhost:3200
# 不用 ENV 中转：classic builder 的 ENV 层缓存键不含 ARG 实参，换 BFF 地址重建会
# 错误复用旧缓存层。在 RUN 里直接引用 ARG，缓存键包含实参，地址变更必然重建。
RUN cd apps/m-ui && VITE_MERISTEM_MUI_BFF_URL="$VITE_MERISTEM_MUI_BFF_URL" bun run build

FROM oven/bun:${BUN_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /srv/m-ui
COPY --from=build /app/apps/m-ui/build ./site
COPY scripts/serve-static-dir.ts ./serve-static-dir.ts
USER bun
EXPOSE 4173
CMD ["bun", "run", "serve-static-dir.ts", "site"]
