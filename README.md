# Finance CRM

Finance CRM is planned as a modular monolith: NestJS REST API, Next.js staff web client, PostgreSQL as the business source of truth through Prisma, and Redis for background queue transport/cache.

## Current implementation scope

P0-0 provides the Prisma/PostgreSQL client foundation, Redis/BullMQ queue and worker lifecycle, validated runtime configuration, and operational probes. P0-1 provides staff authentication and scoped organization/access-control APIs, with staff web screens for users, branches and roles. P0-2 provides customer, assignment, care history, loan request/contract and related workflows. P0-3 has started with scoped plan/metric creation and listing; tasks, verification and KPI aggregation remain. P0-6 is in progress: staff customer/loan and access-administration screens are available, while customer PWA, realtime chat UI and remaining workflows are not complete. CI pipeline work is excluded from the current continuation. See the [implementation status](docs/phase-0/implementation-status.md) for current verification and limitations.

## Requirements accepted so far

- The CRM core includes customers, assignment, care history, follow-up tasks, plans and verified KPI.
- Loan requests can originate from CUSTOMER or be recorded by ADVISING; requests are intake/tracking, not automated eligibility or approval. A separate contract record is created/linked when a contract actually exists.
- Realtime chat between ADVISING and CUSTOMER is in the MVP. External CRM integration and custom reporting are deferred.
- A customer has one primary assigned adviser at a time, with assignment history retained.
- Customer import uses background preview/row validation/duplicate review and commits the whole batch only after all rows are valid and confirmed.
- CUSTOMER starts with mobile web/PWA; native app is later. Customer mock API is dev/test only.

## Documentation by phase

- [Documentation index](docs/README.md)
- [Phase 0: scope and accepted requirements](docs/phase-0/mvp-scope.md)
- [Phase 0: decision log and remaining configuration](docs/phase-0/decision-log.md)
- [Phase 0: implementation status](docs/phase-0/implementation-status.md)
- [CRM user guide](docs/phase-0/user-guide.md)
- [P0 implementation overview](docs/phase-0/p0-implementation-plan.md)
- [P0 stages index](docs/phase-0/p0/README.md), with one Markdown file for each stage P0-0 through P0-6.

## Prerequisites

- Node.js 24 LTS (the installed Node.js 24.22.2 meets this prerequisite).
- npm.
- Docker Desktop or another Docker Compose implementation for local PostgreSQL and Redis.

## Local development

1. Copy `.env.example` to `.env` in the repository root. Keep the database name/user and password consistent between `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` and `DATABASE_URL`.
2. Set a random `AUTH_ACCESS_TOKEN_SECRET` of at least 32 characters and bootstrap operator username/display name/password in `.env`; keep these local secrets out of source control.
3. Start PostgreSQL and Redis with `docker compose up -d postgres redis`.
4. Install locked dependencies with `npm ci`.
5. Generate Prisma client and apply the P0-1 schema: `npm run db:generate` then `npm run db:migrate:dev`.
6. Seed the permission catalog/system roles and initial operator: `npm run db:seed`. In development the runner generates the Prisma client and builds before seeding; when the plans table is empty it also seeds four demo plans against active branches, without replacing existing plans. Demo plans are never seeded in test or production. The production Docker image uses its prebuilt client. It loads `.env.dev`, `.env.test`, or `.env.prod` based on `NODE_ENV`, while explicit shell/container variables take precedence.
7. Start API: `npm run dev:api` (default `http://localhost:3001`).
8. Start background worker in another terminal: `npm run dev:worker`.
9. Start web: `npm run dev:web` (default `http://localhost:3000`).

API probes: `GET /health` (process liveness) and `GET /ready` (PostgreSQL and Redis readiness). OpenAPI UI is served at `/api/docs` in non-production environments. Staff auth and scoped access administration are documented in the [P0-1 plan](docs/phase-0/p0/p0-1-access-control.md). Database schema changes are managed by Prisma migrations; run `npm run db:migrate:dev` for local development and `npm run db:migrate:deploy` in deployment workflows.

## Docker Compose deployment

1. Copy `.env.example` to `.env`, then set `AUTH_ACCESS_TOKEN_SECRET` to a unique random value of at least 32 characters. Keep `.env` outside source control.
2. Ensure `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` are set. Compose derives the internal PostgreSQL URL from these values; its `DATABASE_URL` value for local commands may remain `localhost`.
3. Build and start the stack with `docker compose up --build -d`. The `migrate` one-shot service applies committed migrations before API and worker start.
4. Set bootstrap operator values in `.env`, then execute `docker compose --profile ops run --rm seed` once. The one-shot `seed` service receives bootstrap credentials without exposing them to the API/worker or routine migration container.

API and web ports bind only to `127.0.0.1`. Put a TLS reverse proxy in front of them for external traffic; PostgreSQL and Redis remain private to the Compose network.

### Separate environments

Create local, ignored files from `.env.dev.example`, `.env.test.example`, and `.env.prod.example` named `.env.dev`, `.env.test`, and `.env.prod`. Use a different database, ports, volumes, and `AUTH_ACCESS_TOKEN_SECRET` for each environment. Production secrets belong in the deployment secret manager; never commit the populated `.env.*` files.

Run and manage each stack with the matching npm scripts:

- Development: `npm run docker:dev:up`, `npm run docker:dev:ps`, `npm run docker:dev:logs`, `npm run docker:dev:down`.
- Test: `npm run docker:test:up`, `npm run docker:test:ps`, `npm run docker:test:logs`, `npm run docker:test:down`.
- Production: `npm run docker:prod:up`, `npm run docker:prod:ps`, `npm run docker:prod:logs`, `npm run docker:prod:down`.

Each command reads only its matching `.env.*` file. Copy the corresponding `.env.*.example` before running it. Use the `docker-compose` command directly if you need to target an individual service.

These use distinct Docker volumes; stop a stack with the same `--env-file` and `-f` arguments followed by `down`. Do not add `-v` unless deleting that environment's database is intended.

The Bash equivalent accepts an environment and action, with optional service names for `ps` and `logs`:

```bash
bash scripts/docker-compose.sh dev up
bash scripts/docker-compose.sh test ps
bash scripts/docker-compose.sh prod logs api
bash scripts/docker-compose.sh dev down
```

It uses the same environment files and Compose overlays as the npm scripts above. The `up` action builds and starts the stack in the background; `logs` follows output.

## Checks

- `npm run typecheck`
- `npm run test`
- `npm run build`

No production-readiness claim is made by this scaffold. See `AGENT.md`, the Phase 0 decision log, and P0 stage plans for required controls, gates and remaining configuration.
