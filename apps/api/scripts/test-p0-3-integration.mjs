import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const baseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? '3001'}/api/v1`;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const databaseName = new URL(databaseUrl).pathname.toLowerCase();
if (process.env.NODE_ENV !== 'test' || !/(?:_test|_ci)$/.test(databaseName)) {
  throw new Error('P0-3 integration tests require NODE_ENV=test and a database ending in _test or _ci');
}
const adminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!adminUsername || !adminPassword) {
  throw new Error('Bootstrap admin credentials are required for P0-3 integration tests');
}

const db = new pg.Client({ connectionString: databaseUrl });
const branchId = randomUUID();
const managerId = randomUUID();
const adviserId = randomUUID();
const planIds = [];
const branchCode = `CI-P03-${branchId.slice(0, 8)}`;
const managerUsername = `ci_p03_manager_${managerId.slice(0, 8)}`;
const adviserUsername = `ci_p03_adviser_${adviserId.slice(0, 8)}`;
const managerPassword = `Ci-P0-3-Manager-${managerId.slice(0, 8)}-Strong-9!`;
const adviserPassword = `Ci-P0-3-Adviser-${adviserId.slice(0, 8)}-Strong-9!`;

const check = (condition, label, details) => {
  if (!condition) {
    throw new Error(`P0-3 integration assertion failed: ${label}${details ? ` (${details})` : ''}`);
  }
  process.stdout.write(`PASS ${label}\n`);
};

async function responseJson(response) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* preserve HTTP status for failure output */ }
  return { status: response.status, body };
}

async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return responseJson(response);
}

async function login(username, password) {
  const result = await api('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  check(result.status === 200 || result.status === 201, `login ${username}`, `HTTP ${result.status}`);
  return result.body.accessToken;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(baseUrl.replace(/\/api\/v1$/, '/ready'));
      if (response.ok) return;
    } catch { /* API container is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('API did not become ready within 30 seconds');
}

async function passwordHash(password) {
  const salt = randomBytes(16);
  const key = await promisify(scryptCallback)(password, salt, 64, {
    N: 32_768,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
}

async function seedActors() {
  const roles = await db.query('SELECT "id", "key" FROM "Role" WHERE "key" = ANY($1::text[])', [
    ['MANAGE', 'ADVISING'],
  ]);
  const roleIds = new Map(roles.rows.map(({ id, key }) => [key, id]));
  if (!roleIds.has('MANAGE') || !roleIds.has('ADVISING')) {
    throw new Error('System MANAGE and ADVISING roles must be seeded before P0-3 integration tests');
  }

  const managerHash = await passwordHash(managerPassword);
  const adviserHash = await passwordHash(adviserPassword);
  await db.query(
    `INSERT INTO "User" ("id","username","displayName","passwordHash","status","mustChangePassword","passwordChangedAt","createdAt","updatedAt")
     VALUES
       ($1,$2,'P0-3 CI Manager',$3,'ACTIVE',false,NOW(),NOW(),NOW()),
       ($4,$5,'P0-3 CI Adviser',$6,'ACTIVE',false,NOW(),NOW(),NOW())`,
    [managerId, managerUsername, managerHash, adviserId, adviserUsername, adviserHash],
  );
  await db.query(
    `INSERT INTO "Branch" ("id","code","name","managerUserId","status","createdAt","updatedAt")
     VALUES ($1,$2,'P0-3 CI Branch',$3,'ACTIVE',NOW(),NOW())`,
    [branchId, branchCode, managerId],
  );
  await db.query(
    `INSERT INTO "UserRoleGrant" ("id","userId","roleId","branchId","scopeAnchor","createdById","createdAt")
     VALUES
       ($1,$2,$3,$4,$9,$5,NOW()),
       ($6,$7,$8,$4,$9,$5,NOW())`,
    [
      randomUUID(), managerId, roleIds.get('MANAGE'), branchId, null,
      randomUUID(), adviserId, roleIds.get('ADVISING'), branchId,
    ],
  );
}

async function cleanup() {
  await db.query('DELETE FROM "AuditEvent" WHERE "branchId" = $1', [branchId]);
  await db.query(
    `DELETE FROM "TaskVerification"
     WHERE "resultId" IN (
       SELECT result."id" FROM "TaskResult" result
       JOIN "Task" task ON task."id" = result."taskId"
       WHERE task."planId" = ANY($1::uuid[])
     )`,
    [planIds],
  );
  await db.query(
    `DELETE FROM "TaskResultEvidence"
     WHERE "resultId" IN (
       SELECT result."id" FROM "TaskResult" result
       JOIN "Task" task ON task."id" = result."taskId"
       WHERE task."planId" = ANY($1::uuid[])
     )`,
    [planIds],
  );
  await db.query(
    `DELETE FROM "TaskResult" WHERE "taskId" IN (SELECT "id" FROM "Task" WHERE "planId" = ANY($1::uuid[]))`,
    [planIds],
  );
  await db.query(
    `DELETE FROM "TaskAssignment" WHERE "taskId" IN (SELECT "id" FROM "Task" WHERE "planId" = ANY($1::uuid[]))`,
    [planIds],
  );
  await db.query('DELETE FROM "Task" WHERE "planId" = ANY($1::uuid[])', [planIds]);
  await db.query('DELETE FROM "PlanApproval" WHERE "planId" = ANY($1::uuid[])', [planIds]);
  await db.query('DELETE FROM "PlanMetric" WHERE "planId" = ANY($1::uuid[])', [planIds]);
  await db.query('DELETE FROM "PlanBranch" WHERE "planId" = ANY($1::uuid[])', [planIds]);
  await db.query('DELETE FROM "Plan" WHERE "id" = ANY($1::uuid[])', [planIds]);
  await db.query('DELETE FROM "UserRoleGrant" WHERE "userId" = ANY($1::uuid[])', [[managerId, adviserId]]);
  await db.query(
    `UPDATE "Branch"
     SET "managerUserId" = NULL, "status" = 'INACTIVE'
     WHERE "id" = $1`,
    [branchId],
  );
  await db.query('DELETE FROM "Branch" WHERE "id" = $1', [branchId]);
  await db.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [[managerId, adviserId]]);
}

await db.connect();
try {
  await waitForApi();
  await seedActors();
  const adminToken = await login(adminUsername, adminPassword);
  const managerToken = await login(managerUsername, managerPassword);
  const adviserToken = await login(adviserUsername, adviserPassword);

  const catalog = await api('/plans/metric-catalog', { token: adminToken });
  check(catalog.status === 200 && catalog.body.some(({ isActive }) => isActive), 'active KPI catalog is available');
  const metric = catalog.body.find(({ isActive }) => isActive);
  const now = new Date();
  const planStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const planEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const planResponse = await api('/plans', {
    token: adminToken,
    method: 'POST',
    body: {
      name: `P0-3 CI plan ${branchId.slice(0, 8)}`,
      branchIds: [branchId],
      periodStart: planStart.toISOString(),
      periodEnd: planEnd.toISOString(),
      metrics: [{ catalogId: metric.id, target: 10 }],
    },
  });
  check(planResponse.status === 201 && planResponse.body.status === 'DRAFT', 'admin creates a draft plan');
  const planId = planResponse.body.id;
  planIds.push(planId);
  const planMetric = planResponse.body.metrics[0];

  const submittedPlan = await api(`/plans/${planId}/submissions`, {
    token: adminToken,
    method: 'POST',
  });
  check(submittedPlan.status === 201 && submittedPlan.body.status === 'PENDING_APPROVAL', 'plan enters approval workflow');
  const selfApproval = await api(`/plans/${planId}/approvals`, {
    token: adminToken,
    method: 'POST',
    body: { decision: 'APPROVED' },
  });
  check(
    selfApproval.status === 201 && selfApproval.body.status === 'ACTIVE',
    'global administrator manually approves their own submitted plan',
    `HTTP ${selfApproval.status}: ${JSON.stringify(selfApproval.body)}`,
  );

  const managerPlanResponse = await api('/plans', {
    token: managerToken,
    method: 'POST',
    body: {
      name: `P0-3 CI manager plan ${branchId.slice(0, 8)}`,
      branchIds: [branchId],
      periodStart: planStart.toISOString(),
      periodEnd: planEnd.toISOString(),
      metrics: [{ catalogId: metric.id, target: 10 }],
    },
  });
  check(
    managerPlanResponse.status === 201 && managerPlanResponse.body.status === 'DRAFT',
    'branch manager creates a draft plan',
  );
  const managerPlanId = managerPlanResponse.body.id;
  planIds.push(managerPlanId);
  const managerSubmittedPlan = await api(`/plans/${managerPlanId}/submissions`, {
    token: managerToken,
    method: 'POST',
  });
  check(
    managerSubmittedPlan.status === 201 && managerSubmittedPlan.body.status === 'PENDING_APPROVAL',
    'manager plan enters approval workflow',
  );
  const managerSelfApproval = await api(`/plans/${managerPlanId}/approvals`, {
    token: managerToken,
    method: 'POST',
    body: { decision: 'APPROVED' },
  });
  check(managerSelfApproval.status === 403, 'non-admin creator cannot approve their own plan');
  const approvedManagerPlan = await api(`/plans/${managerPlanId}/approvals`, {
    token: adminToken,
    method: 'POST',
    body: { decision: 'APPROVED' },
  });
  check(
    approvedManagerPlan.status === 201 && approvedManagerPlan.body.status === 'ACTIVE',
    'admin approves a plan created by another reviewer',
  );

  const taskResponse = await api(`/plans/${planId}/tasks`, {
    token: adminToken,
    method: 'POST',
    body: {
      metricId: planMetric.id,
      branchId,
      title: 'P0-3 CI task',
      target: 10,
      assigneeIds: [adviserId],
    },
  });
  check(taskResponse.status === 201 && taskResponse.body.length === 1, 'admin assigns a task to one branch adviser');
  const assignment = taskResponse.body[0];
  check(assignment.assignee.id === adviserId && assignment.target === 10, 'assignment stores its own recipient and target');

  const visibleTasks = await api(`/plans/${planId}/tasks`, { token: adviserToken });
  check(
    visibleTasks.status === 200 && visibleTasks.body.length === 1 && visibleTasks.body[0].id === assignment.id,
    'assigned adviser sees only their task assignment',
  );
  const occurredAt = new Date().toISOString();
  const resultResponse = await api(`/tasks/${assignment.taskId}/results`, {
    token: adviserToken,
    method: 'POST',
    body: {
      reportedValue: 6,
      reportedUnit: planMetric.unit,
      narrative: 'P0-3 integration result',
      occurredAt,
    },
  });
  check(
    resultResponse.status === 201 &&
      resultResponse.body.verificationStatus === 'PENDING_VERIFICATION' &&
      resultResponse.body.revision === 1,
    'adviser submits an immutable pending result revision',
  );

  const pendingKpi = await api(`/plans/${planId}/kpi?periodType=PLAN`, { token: adviserToken });
  const pendingMetric = pendingKpi.body.find(({ metricId }) => metricId === planMetric.id);
  check(
    pendingKpi.status === 200 && pendingMetric?.verifiedTotal === 0 && pendingMetric.target === 10,
    'unverified result is excluded while personal target remains scoped',
  );

  const verification = await api(`/task-results/${resultResponse.body.id}/verifications`, {
    token: managerToken,
    method: 'POST',
    body: { status: 'VERIFIED' },
  });
  check(verification.status === 201 && verification.body.status === 'VERIFIED', 'branch manager verifies the submitted result');

  const verifiedKpi = await api(`/plans/${planId}/kpi?periodType=PLAN`, { token: adviserToken });
  const verifiedMetric = verifiedKpi.body.find(({ metricId }) => metricId === planMetric.id);
  check(
    verifiedKpi.status === 200 && verifiedMetric?.verifiedTotal === 6 && verifiedMetric.target === 10,
    'verified result contributes to the assigned adviser KPI',
  );

  const latestResult = await db.query(
    `SELECT result."revision", verification."status"
     FROM "TaskResult" result
     LEFT JOIN "TaskVerification" verification ON verification."resultId" = result."id"
     WHERE result."id" = $1`,
    [resultResponse.body.id],
  );
  check(
    latestResult.rows[0]?.revision === 1 && latestResult.rows[0]?.status === 'VERIFIED',
    'PostgreSQL persists the result revision and verification relation',
  );
  process.stdout.write('P0-3 API/PostgreSQL integration tests passed.\n');
} finally {
  await cleanup();
  await db.end();
}
