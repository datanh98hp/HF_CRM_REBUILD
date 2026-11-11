#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/docker-compose.sh <dev|test|prod> <up|down|ps|logs> [service...]

Examples:
  bash scripts/docker-compose.sh dev up
  bash scripts/docker-compose.sh test ps
  bash scripts/docker-compose.sh prod logs api
EOF
}

if [[ $# -lt 2 ]]; then
  usage >&2
  exit 2
fi

environment=$1
action=$2
shift 2

case "$environment" in
  dev|test|prod) ;;
  *)
    printf 'Unknown environment: %s\n' "$environment" >&2
    usage >&2
    exit 2
    ;;
esac

case "$action" in
  up|down|ps|logs) ;;
  *)
    printf 'Unknown action: %s\n' "$action" >&2
    usage >&2
    exit 2
    ;;
esac

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

env_file=".env.$environment"
if [[ ! -f "$env_file" ]]; then
  printf 'Missing %s. Copy .env.%s.example to %s and configure it first.\n' \
    "$env_file" "$environment" "$env_file" >&2
  exit 1
fi

compose_args=(
  --env-file "$env_file"
  -f docker-compose.yml
  -f "docker-compose.$environment.yml"
)

case "$action" in
  up)
    docker compose "${compose_args[@]}" up --build -d "$@"
    ;;
  down)
    docker compose "${compose_args[@]}" down "$@"
    ;;
  ps)
    docker compose "${compose_args[@]}" ps "$@"
    ;;
  logs)
    docker compose "${compose_args[@]}" logs --follow "$@"
    ;;
esac
