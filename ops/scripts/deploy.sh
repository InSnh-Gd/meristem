#!/usr/bin/env bash
# 远程主机部署：同步生产 compose 与环境文件，然后在目标主机执行
# docker compose pull && docker compose up -d（镜像由 CI 推送到 registry）。
#
# 用法：
#   ops/scripts/deploy.sh <user@host> [env-file]
# 环境变量：
#   MERISTEM_REGISTRY   镜像仓库（默认读取 env-file 中的值）
#   MERISTEM_TAG        部署镜像 tag（默认 latest）
#   MERISTEM_COMPOSE_DIR  目标主机上的 compose 目录（默认 /opt/meristem）
set -euo pipefail

TARGET_HOST=${1:?usage: ops/scripts/deploy.sh <user@host> [env-file]}
ENV_FILE=${2:-ops/compose/meristem.prod.env}
COMPOSE_FILE=ops/compose/meristem.prod.yml
REMOTE_DIR=${MERISTEM_COMPOSE_DIR:-/opt/meristem}

[ -f "$ENV_FILE" ] || { echo "env file not found: $ENV_FILE (copy meristem.prod.env.example and fill it)" >&2; exit 1; }

ssh "$TARGET_HOST" "mkdir -p '$REMOTE_DIR'"
scp "$COMPOSE_FILE" "$TARGET_HOST:$REMOTE_DIR/meristem.prod.yml"
scp "$ENV_FILE" "$TARGET_HOST:$REMOTE_DIR/meristem.prod.env"

ssh "$TARGET_HOST" "cd '$REMOTE_DIR' && \
  MERISTEM_TAG=${MERISTEM_TAG:-latest} docker compose \
    -f meristem.prod.yml --env-file meristem.prod.env pull && \
  MERISTEM_TAG=${MERISTEM_TAG:-latest} docker compose \
    -f meristem.prod.yml --env-file meristem.prod.env up -d --remove-orphans"

echo "deployed tag ${MERISTEM_TAG:-latest} to $TARGET_HOST:$REMOTE_DIR"
