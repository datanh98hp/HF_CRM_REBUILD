#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/docker-compose.sh <dev|test|prod> <up|down|ps|logs> [service...]
  bash scripts/docker-compose.sh <dev|test|prod> app <npm-script> [script-args...]

Compose lifecycle commands run on the host. Application npm scripts run in the
toolbox container.

Examples:
  bash scripts/docker-compose.sh dev up
  bash scripts/docker-compose.sh test ps
  bash scripts/docker-compose.sh prod logs api
  bash scripts/docker-compose.sh dev app typecheck:container
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
  up|down|ps|logs|app) ;;
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

compose() {
  docker compose "${compose_args[@]}" "$@"
}

read_env_value() {
  local key=$1
  local value
  value=$(grep -m 1 "^${key}=" "$env_file" | cut -d '=' -f 2- || true)
  value=${value%$'\r'}
  value=${value#\"}
  value=${value%\"}
  value=${value#\'}
  value=${value%\'}
  printf '%s' "$value"
}

container_database_url() {
  local database_url=${DATABASE_URL:-}
  if [[ -z "$database_url" ]]; then
    database_url=$(read_env_value DATABASE_URL)
  fi
  if [[ -z "$database_url" || "$database_url" != *"://"* || "$database_url" != *@* ]]; then
    printf 'DATABASE_URL in %s must be a PostgreSQL URL with credentials.\n' "$env_file" >&2
    return 1
  fi

  local protocol=${database_url%%://*}
  local remainder=${database_url#*://}
  local credentials=${remainder%%@*}
  local host_and_database=${remainder#*@}
  if [[ "$host_and_database" == "$remainder" || "$host_and_database" != */* ]]; then
    printf 'DATABASE_URL in %s must include a database name.\n' "$env_file" >&2
    return 1
  fi

  printf '%s://%s@postgres:5432/%s' "$protocol" "$credentials" "${host_and_database#*/}"
}

run_app_script() {
  if [[ $# -lt 1 ]]; then
    usage >&2
    exit 2
  fi

  local script_name=$1
  shift
  export TOOLBOX_DATABASE_URL
  TOOLBOX_DATABASE_URL=$(container_database_url)

  local api_port web_port
  api_port=$(read_env_value API_PORT)
  web_port=$(read_env_value WEB_PORT)

  case "$script_name" in
    dev:api:container|dev:worker:container|db:seed:container|db:migrate:dev:container|db:migrate:deploy:container)
      compose up -d postgres redis
      ;;
    test:integration:container)
      compose up -d api
      ;;
  esac

  local -a port_args=()
  case "$script_name" in
    dev:api:container)
      port_args=(-p "127.0.0.1:${api_port:-3001}:3001")
      ;;
    dev:web:container)
      port_args=(-p "127.0.0.1:${web_port:-3000}:3000")
      ;;
  esac

  local lock_guard='expected=$(sha256sum package-lock.json | cut -d" " -f1)
actual=$(cat node_modules/.finance-crm-package-lock 2>/dev/null || true)
if [ "$expected" != "$actual" ]; then
  npm ci
  printf "%s\n" "$expected" > node_modules/.finance-crm-package-lock
fi
script=$1
shift
exec npm run "$script" -- "$@"'

  compose --profile tools run --build --rm --no-deps "${port_args[@]}" \
    toolbox sh -lc "$lock_guard" toolbox "$script_name" "$@"
}

case "$action" in
  up)
    compose up --build -d "$@"
    ;;
  down)
    compose down "$@"
    ;;
  ps)
    compose ps "$@"
    ;;
  logs)
    compose logs --follow "$@"
    ;;
  app)
    run_app_script "$@"
    ;;
esac
