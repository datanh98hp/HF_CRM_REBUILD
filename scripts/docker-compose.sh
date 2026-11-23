#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/docker-compose.sh <dev|test|prod|prod-local> <up|down|ps|logs|seed> [service...]
  bash scripts/docker-compose.sh <dev|test|prod|prod-local> app <npm-script> [script-args...]

Compose lifecycle commands run on the host. Application npm scripts run in the
toolbox container.

Examples:
  bash scripts/docker-compose.sh dev up
  bash scripts/docker-compose.sh test ps
  bash scripts/docker-compose.sh prod logs api
  bash scripts/docker-compose.sh prod-local up
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
  dev|test|prod|prod-local) ;;
  *)
    printf 'Unknown environment: %s\n' "$environment" >&2
    usage >&2
    exit 2
    ;;
esac

case "$action" in
  up|down|ps|logs|seed|app) ;;
  *)
    printf 'Unknown action: %s\n' "$action" >&2
    usage >&2
    exit 2
    ;;
esac

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

if [[ "$environment" == "prod-local" ]]; then
  env_file=".env.prod.local"
else
  env_file=".env.$environment"
fi
if [[ ! -f "$env_file" ]]; then
  if [[ "$environment" == "prod-local" ]]; then
    printf 'Missing %s. Copy .env.prod.local.example to %s and configure it first.\n' \
      "$env_file" "$env_file" >&2
  else
    printf 'Missing %s. Copy .env.%s.example to %s and configure it first.\n' \
      "$env_file" "$environment" "$env_file" >&2
  fi
  exit 1
fi

compose_args=(
  --env-file "$env_file"
  -f docker-compose.yml
)
if [[ "$environment" == "prod-local" ]]; then
  compose_args+=( -f docker-compose.prod.yml -f docker-compose.prod-local.yml )
else
  compose_args+=( -f "docker-compose.$environment.yml" )
fi

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
  if [[ -z "$database_url" && "$environment" == "prod-local" ]]; then
    local postgres_db
    local postgres_user
    local postgres_password
    postgres_db=$(read_env_value POSTGRES_DB)
    postgres_user=$(read_env_value POSTGRES_USER)
    postgres_password=$(read_env_value POSTGRES_PASSWORD)
    if [[ -z "$postgres_db" || -z "$postgres_user" || -z "$postgres_password" ]]; then
      printf 'POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD are required in %s.\n' "$env_file" >&2
      return 1
    fi
    printf 'postgresql://%s:%s@postgres:5432/%s?schema=public' \
      "$postgres_user" "$postgres_password" "$postgres_db"
    return 0
  fi
  if [[ -z "$database_url" && "$environment" == "prod" ]]; then
    local postgres_db
    local postgres_user
    local postgres_password
    postgres_db=$(read_env_value POSTGRES_DB)
    postgres_user=$(read_env_value POSTGRES_USER)
    postgres_password=$(read_env_value POSTGRES_PASSWORD)
    if [[ -z "$postgres_db" || -z "$postgres_user" || -z "$postgres_password" ]]; then
      printf 'POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD are required in %s.\n' "$env_file" >&2
      return 1
    fi
    printf 'postgresql://%s:%s@postgres:5432/%s?schema=public' \
      "$postgres_user" "$postgres_password" "$postgres_db"
    return 0
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
    if [[ "$environment" == "prod-local" ]]; then
      api_replicas=$(read_env_value API_REPLICAS)
      worker_replicas=$(read_env_value WORKER_REPLICAS)
      api_replicas=${api_replicas:-2}
      worker_replicas=${worker_replicas:-2}
      compose up --build --scale "api=$api_replicas" --scale "worker=$worker_replicas" -d "$@"
    else
      compose up --build -d "$@"
    fi
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
  seed)
    compose --profile ops run --rm seed
    ;;
  app)
    run_app_script "$@"
    ;;
esac
