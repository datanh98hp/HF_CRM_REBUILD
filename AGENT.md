# FINANCE CRM — PROJECT AGENT INSTRUCTIONS
Version: 1.0
Baseline: Finance CRM v1.4.0 — RBAC + PostgreSQL
Language: Vietnamese by default.

## 1. Mission
Build and maintain Finance CRM / HFinance / VietP2P: customer management, loan products, loan applications, advising, care history, tasks, chat, reporting, files, notifications, and CRM integrations. Act as a senior solution architect and implementation engineer. Prioritize correctness, security, traceability, maintainability, and operational reliability.

## 2. Source-of-truth rules
- Inspect the actual repository before changing anything. Review tree, package manifests/lockfiles, README, Prisma schema/migrations, tests, CI, and existing architecture.
- Treat the accepted repository and migrations as implementation truth. Finance CRM v1.4.0 is the agreed baseline unless a newer release is explicitly accepted.
- Do not mix v1.3.x experiments or generated scaffolds into v1.4.0 silently.
- Do not assume a feature exists because it was discussed or reported. Verify code and tests.
- Preserve existing conventions; make small, reviewable changes. Keep a modular monolith; do not introduce microservices without a documented need.
- Never claim a command, test, audit, migration, build, deployment, or security control succeeded unless actually run and inspected.
- Never weaken tests, suppress errors, or use `continue-on-error` to conceal mandatory security failures.
- Never commit secrets, tokens, passwords, production data, or real customer records.
- After each task, report changed files, commands actually run, outcomes, skipped checks, blockers, risks, and remaining work.

## 3. Architecture baseline
- Backend: NestJS modular monolith; REST `/api/v1`; OpenAPI; Socket.IO for realtime chat where required.
- Data: PostgreSQL + Prisma are the business source of truth.
- Redis: cache/queues only; not the sole durable store for messages or business events.
- Files: private S3-compatible storage behind an `ObjectStorageService` abstraction.
- Web: Next.js + TypeScript for platform admins, branch managers, and advisers; customer web scope subject to approval.
- Mobile: React Native + Expo is the preferred future cross-platform option.
- All clients use backend API contracts; never connect a frontend directly to PostgreSQL.
- Deployment: Docker Compose is acceptable for local/initial single-node deployment but is not HA. Use reverse proxy/TLS, isolated networks, non-root containers, health checks, resource limits, log rotation, persistent storage, separate environments, controlled migrations, backups, and tested restore. Do not expose DB/Redis/worker/storage admin ports publicly.

## 4. Domain modules
Expected modules: auth, users, access-control, branches, customers, loan-products, loan-calculator, loan-applications, advising, conversations, tasks, files, notifications, audit, integrations, reports. Avoid cross-module repository access and circular dependencies. Use public services/interfaces or documented domain events. Do not impose full CQRS without justification.

## 5. RBAC and Data Scope — security critical
Roles:
- `OPERATOR`: platform administration only for explicitly granted permissions.
- `ADMIN`: business/user configuration within authorized scope.
- `MANAGE`: branch management and reporting within branch scope.
- `ADVISING`: assigned customers/applications, advising, conversations, care history.
- `CUSTOMER`: own profile, applications, documents, conversations.

Use stable permission keys, e.g. `users.read`, `users.manage`, `roles.read`, `roles.manage`, `customers.read`, `customers.assign`, `loan-products.publish`, `loan-applications.assign`, `advising.message.send`, `files.download`, `reports.read`, `webhooks.replay`, `audit.read`. Register permissions centrally; never accept arbitrary client-supplied permission definitions.

Scopes:
- `OWN`: own resources.
- `ASSIGNED`: resources assigned to the authenticated user.
- `BRANCH`: resources in authorized branch(es).
- `ALL`: global scope only when explicitly granted.

Every protected backend endpoint must enforce both action permission and resource-level scope. Hiding a sidebar item is UX only, never authorization.

Privilege escalation controls:
- Users cannot grant themselves roles/permissions beyond their delegation authority.
- Role managers can grant only permissions explicitly included in their grantable set.
- Protect system roles/reserved permissions.
- Validate actor and target scope; prevent unauthorized changes to higher-privilege users.
- Cover alternate/bulk APIs and direct DTO fields; do not rely on UI restrictions.
- Perform role/permission mutation and audit write in one transaction.
- Audit records should be append-only to application actors where feasible. Record actor, target, action, safe before/after diff, timestamp, request/correlation ID, and reason where required. Never log secrets.
- Resolve current permissions on each protected request or use a rigorously invalidated permission/session version cache. Revocation must take effect on the next request (or within a documented consistency window).
- `/api/v1/auth/me` exposes current effective permissions/scope for UI rendering, but is not the enforcement point.

Required tests:
- ADVISING can read assigned customer/application, cannot read another adviser's records.
- MANAGE can read own branch, cannot read another branch.
- CUSTOMER can read own records, cannot read another customer's records.
- ADMIN is constrained to its configured scope.
- Self-role escalation and granting permissions outside delegation authority are denied.
- Revoked permissions are denied on the next request.
- A permission mutation without its audit record must not commit.
- Test IDOR across customers, applications, files, conversations, and reports.

## 6. Authentication
Use secure password hashing (Argon2id or approved equivalent), non-enumerating login errors, short-lived access tokens, secure refresh/session handling when implemented, hashed refresh tokens, rotation/reuse detection, account disablement, rate limits, and safe cookie/CSRF controls where applicable. Never store plaintext credentials. MFA is not implemented unless code and tests prove it. Keep authentication separate from authorization.

## 7. Customers and loan applications
- Support customer lifecycle, duplicate detection/review, contact/identity data, provenance, and verification status.
- Distinguish customer-declared data from verified data.
- Enforce scope on list/search/detail/export/update/file APIs.
- Suggested application states: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `NEEDS_INFORMATION`, `APPROVED`, `REJECTED`, `CANCELLED`.
- Enforce transitions in backend state machine; record actor, timestamp, from/to state, and reason.
- Preserve application history and policy version.
- Eligibility/prequalification is not formal loan approval.

## 8. Loan products and financial rules
Products/packages include amount min/max, term range, rate and rate basis, calculation/amortization method, fees, conditions, effective dates, policy version, and required documents.
Structured eligibility categories may include age, identity, credit history, income/evidence, employment/residence, collateral, custom conditions, and documents. Outcomes: `PASS`, `FAIL`, `PENDING_VERIFICATION`, `MISSING_DATA`, `NOT_APPLICABLE`; aggregate: `ELIGIBLE`, `INELIGIBLE`, `NEEDS_REVIEW`.
Never execute arbitrary SQL/JS/user expressions as rules. Version policies so historical applications retain the evaluated version.
Use decimal-safe arithmetic for money. Define rate basis, period, day-count, compounding, amortization, fees, and rounding. Distinguish estimates from official schedules. Never invent financial/legal rules; ask the business owner when unclear.

## 9. Advising, tasks, chat
- Keep `advising_requests` separate from `conversations`; a customer may request an adviser without an application.
- Capture request time, customer, branch, topic, optional product/package/application, assignment/acceptance history, and outcome.
- Care history records time, channel, content, result, and adviser.
- Tasks support due dates, assignment, reminders, completion, and notifications.
- Enforce scope on requests, care records, tasks, and conversations.
- Persist chat messages to PostgreSQL before acknowledging success. Use cursor pagination, idempotency, reconnect/offline sync, and delivery/read states where needed.
- Authorize every socket connection, room join, send, read, and supervisor action.
- Never send file binaries through Socket.IO; use protected HTTP or short-lived authorized presigned URLs.

Candidate socket events: `conversation:join`, `conversation:leave`, `message:send`, `message:new`, `message:read`, `message:delivery-status`, `conversation:assigned`, `conversation:status-changed`, `advising-request:created`, `advising-request:accepted`, `advising-request:requeued`. Version and document event contracts.

## 10. Files and storage
Private storage by default. Store metadata and resource linkage in PostgreSQL. Validate size, extension, MIME, and file signature; scan/quarantine before approval. Authorize upload/download/preview/delete on every request. Use short-lived presigned URLs only after authorization. Defend against path traversal, unsafe filenames, MIME spoofing, and SSRF. Define retention, deletion, backup, and legal hold. Do not couple business code to one storage provider.

## 11. CRM integrations and webhooks
Use transactional outbox: commit business change and outbox event in one DB transaction, dispatch asynchronously. Never call external CRM synchronously inside the business transaction.
Webhook controls: HMAC signature, timestamp/replay protection, SSRF and redirect defenses, private-network/DNS-rebinding protections, bounded timeouts, idempotency, exponential backoff+jitter, dead-letter, controlled replay with permission and audit. Avoid sensitive payloads by default.
Event envelope: `eventId`, `eventType`, `schemaVersion`, `occurredAt`, `aggregateType`, `aggregateId`, `correlationId`, `data`.
Candidate events: `customer.created`, `customer.updated`, `loan_application.created`, `loan_application.assigned`, `loan_application.status_changed`, `advising_request.created`, `advising_request.accepted`, `conversation.resolved`, `product.published`.
Log delivery metadata and safe errors; never log secrets. Distinguish HTTP 2xx acceptance from downstream business confirmation. Report success, latency P50/P95/P99, backlog age, retries, dead letters.

## 12. API conventions
- `/api/v1`, OpenAPI updated with every API change.
- Validate DTOs at boundaries; reject invalid/unknown fields as appropriate.
- Safe serialization; never expose ORM objects, password hashes, tokens, or secrets.
- Request/correlation IDs, stable error codes, consistent envelopes, cursor pagination, idempotency for retry-prone creates.
- Correct 401/403/404/409/422 and safe 5xx behavior. No stack traces/secrets to clients.
- `/health` and `/ready`; readiness checks required dependencies without leaking connection details.
- Protect search/list/export against scope bypass and resource exhaustion.

## 13. Frontend and sidebar
Group navigation by business area: Dashboard; Customers & Advising; Products & Loan Applications; Reports & Integrations; System Administration. Each item references a stable permission key. Render using current effective permissions. Provide role/permission UI with group and individual controls, search, and clear allow/deny state. Frontend filtering is not a security boundary. Support responsive layout, keyboard navigation, active routes, accessible labels, and safe handling of 403.

For features with a frontend, implement the corresponding route and user flow in the same feature slice after the backend API contract is available and verified. Do not defer frontend work to a later phase unless the user explicitly excludes it or a documented dependency blocks it.

## 14. Dashboard and reporting
Provide role/scope-aware dashboards for adviser, branch manager, administrator, and operator. All aggregates and exports must enforce the same scope as source records. Define metric formulas and time zones. Avoid unnecessary personal/financial data. Reconcile dashboard totals with source queries.

## 15. Quality gates and tests
Required as applicable:
1. Unit tests for domain rules/policies.
2. Integration tests against real PostgreSQL or faithful isolated DB.
3. API E2E for authentication, RBAC, data scope, state transitions.
4. Frontend navigation/permission tests.
5. Security tests: IDOR, privilege escalation, injection, SSRF, uploads, rate limits.
6. Lint, typecheck, builds.
7. Dependency/container vulnerability scans.
8. Migration and backup/restore tests.
9. Load/performance tests for critical flows before production.

CI must fail on required quality gates. Do not use `continue-on-error` for mandatory audit. If an advisory cannot safely be fixed, document package/advisory/exposure/mitigation/owner/expiry; do not call it fixed. Report exact commands and classify results as passed, failed, skipped, or blocked. Source inspection alone is not a successful test.

## 16. Dependency maintenance
Inspect dependency tree and advisory details before changes. Prefer compatible patched versions in current major. Major upgrades (NestJS, Prisma, Next.js) require release-note review, migration plan, and regression tests. Never add blind `overrides`. Keep manifests and lockfile synchronized; use reproducible installs. Run appropriate production and full audits. Do not remove a framework dependency merely because an endpoint is not currently exposed. If registry access fails, disclose that audit/install was not verified.

## 17. Database and migrations
PostgreSQL is source of truth. Every schema change requires Prisma migration and compatibility analysis. Use transactions for multi-record operations, especially RBAC mutations and audit. Add indexes based on scoped queries and query plans. Enforce uniqueness/referential integrity. Use expand-and-contract for production. Never rewrite applied migrations without an approved recovery plan. Test clean and upgrade migrations. Use synthetic/de-identified non-production data. Define retention and backup.

## 18. CI/CD and release
Pipeline: reproducible install from lockfile; lint/format; typecheck; unit; integration/E2E; Prisma validate/generate/migration checks; dependency/container scan; API/web builds; immutable images; staging deploy; smoke tests; controlled production migration/deploy; health checks and rollback readiness.
Run migrations once in a controlled job, not concurrently in every replica. Ensure app/schema compatibility during rolling deploys. Database rollback may require forward-fix or restore. Never claim deployment without evidence.

## 19. Documentation and versioning
Update README, architecture/operations docs, OpenAPI, permission catalog, event schemas, migration/rollback notes, `.env.example` placeholders, tests, CI, and CHANGELOG as relevant.
Use semantic versioning where practical. Do not label a release until contents and tests are verified. Preserve a known-good v1.4.0 baseline; never overwrite the only baseline archive.

## 20. Production readiness
Do not recommend production until evidenced:
- [ ] Reproducible install from committed lockfile.
- [ ] Prisma validation, generation, migrations pass.
- [ ] API and web typecheck/build pass.
- [ ] Required unit/integration/E2E pass.
- [ ] RBAC matrix and data-scope tests pass.
- [ ] Privilege escalation and permission-revocation tests pass.
- [ ] Audit events are transactionally persisted and access-controlled.
- [ ] Dependency/container findings fixed or formally risk-accepted.
- [ ] No secrets/sensitive data in repository/logs.
- [ ] File controls tested if enabled.
- [ ] Backup/restore tested.
- [ ] Monitoring, alerting, log retention, incident response documented.
- [ ] RPO/RTO approved.
- [ ] Staging and business acceptance recorded.

## 21. Open decisions — do not invent
Record owner, options, impact, and decision date for: object-storage provider/data residency; actual loan rates/fees/day-count/amortization; legal basis/provider for credit checks; adviser assignment/SLA/requeue; file types/limits/retention/scanning; external CRM and acknowledgement semantics; production topology/budget/RPO/RTO/monitoring; customer web versus mobile scope; supervisor conversation access; exact compliance standard and meaning of any requested “Level 2”.

## 22. Required implementation report
Respond in Vietnamese unless asked otherwise. Every implementation report must include:
1. Scope completed.
2. Files/modules changed.
3. Database migrations and API contract changes.
4. Exact commands run and outcomes.
5. Tests passed/failed/skipped/blocked.
6. Security/data-integrity implications.
7. Remaining risks/blockers.
8. Verified artifact path/version, if created.
9. Next recommended task.

Be precise. Distinguish code implemented from runtime behavior verified. Never claim “done”, “secure”, “production-ready”, “all tests pass”, or “audit clean” without evidence.
