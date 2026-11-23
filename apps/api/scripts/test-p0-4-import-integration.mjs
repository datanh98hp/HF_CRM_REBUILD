import { randomUUID } from 'node:crypto';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const databaseName = new URL(databaseUrl).pathname.toLowerCase();
if (process.env.NODE_ENV !== 'test' || !/(?:_test|_ci)(?:$|\?)/.test(databaseName)) {
  throw new Error('P0-4 import integration tests require NODE_ENV=test and a database ending in _test or _ci');
}

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';
const db = new pg.Client({ connectionString: databaseUrl });
const createdCustomerIds = [];
let createdBatchId = null;

const check = (condition, label) => {
  if (!condition) throw new Error(`P0-4 import integration assertion failed: ${label}`);
  process.stdout.write(`PASS ${label}\n`);
};

async function responseJson(response) {
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Keep the HTTP status and response text available for the caller.
  }
  return { status: response.status, body };
}

async function login() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) throw new Error('BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD are required');

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const result = await responseJson(response);
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`Bootstrap login failed with HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body.accessToken;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/api\/v1$/, '')}/ready`);
      if (response.ok) return;
    } catch {
      // API container is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('API did not become ready within 30 seconds');
}

async function cleanup() {
  if (createdBatchId) {
    await db.query('DELETE FROM "CustomerImportRow" WHERE "batchId" = $1', [createdBatchId]);
    await db.query('DELETE FROM "CustomerImportBatch" WHERE "id" = $1', [createdBatchId]);
  }
  const fixtureCustomers = await db.query(
    'SELECT "id" FROM "Customer" WHERE "cccd" = $1 AND "provenance" = $2',
    ['001234567890', 'IMPORT'],
  );
  for (const row of fixtureCustomers.rows) {
    if (!createdCustomerIds.includes(row.id)) createdCustomerIds.push(row.id);
  }
  if (createdCustomerIds.length) {
    await db.query('DELETE FROM "CustomerAssignment" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "CustomerStatusHistory" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "DuplicateCandidate" WHERE "customerId" = ANY($1::uuid[]) OR "candidateCustomerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "Customer" WHERE "id" = ANY($1::uuid[])', [createdCustomerIds]);
  }
}

await db.connect();
try {
  await waitForApi();
  const token = await login();
  const headers = { authorization: `Bearer ${token}` };

  const readiness = await responseJson(await fetch(`${baseUrl}/customers/import-batches/readiness`, { headers }));
  check(readiness.status === 200, 'authenticated import readiness route responds');
  check(readiness.body.ready === true, 'partial-row and profile migrations make import ready');

  const branchResult = await db.query(
    `SELECT "id" FROM "Branch" WHERE "status" = 'ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`,
  );
  check(branchResult.rowCount === 1, 'test database has one active branch');
  const branchId = branchResult.rows[0].id;

  const marker = `CI-${randomUUID().slice(0, 8)}`;
  const fullName = `CI Mixed Import ${marker}`;
  const phone = '0987654321';
  const csv = [
    'TT,Họ tên,Số điện thoại,Email,Ngày sinh,CCCD,Địa chỉ,Quê quán,Giới tính,Nơi cấp',
    `1,${fullName},${phone},mixed.${marker.toLowerCase()}@example.test,1992-03-14,001234567890,12 Nguyễn Trãi,Hà Nam,Nữ,Cục Cảnh sát`,
    `2,${fullName},${phone},,,001234567890,12 Nguyễn Trãi,Hà Nam,Nữ,Cục Cảnh sát`,
    '3,,0912345679,,,,,,,',
  ].join('\n');

  const form = new FormData();
  form.set('branchId', branchId);
  form.set('file', new Blob([csv], { type: 'text/csv' }), `p0-4-${marker}.csv`);

  const upload = await responseJson(await fetch(`${baseUrl}/customers/import-batches`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': `p0-4-mixed-${marker}` },
    body: form,
  }));
  check(upload.status === 202, 'mixed-row CSV upload is accepted');
  createdBatchId = upload.body.id;
  check(Boolean(createdBatchId), 'upload returns a batch id');

  let batch = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const detail = await responseJson(await fetch(`${baseUrl}/customers/import-batches/${createdBatchId}`, { headers }));
    if (detail.status === 200 && ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(detail.body.status)) {
      batch = detail.body;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  check(Boolean(batch), 'worker reaches a terminal batch state');
  check(batch.status === 'COMPLETED', 'mixed-row batch completes');
  check(batch.importedRows === 1, 'mixed-row batch imports exactly one valid row');
  check(batch.duplicateRows === 1, 'mixed-row batch counts one in-file duplicate');
  check(batch.invalidRows === 1, 'mixed-row batch retains one invalid row');
  check(batch.failedInsertRows === 0, 'mixed-row batch has no failed insert');

  const customerResult = await db.query(
    `SELECT "id","fullName","phoneNormalized","cccd","address","placeOfOrigin","sex","placeOfIssue"
     FROM "Customer"
     WHERE "phoneNormalized" = $1 AND "cccd" = $2 AND "fullName" = $3`,
    [phone, '001234567890', fullName],
  );
  check(customerResult.rowCount === 1, 'database contains exactly one imported customer');
  const customer = customerResult.rows[0];
  createdCustomerIds.push(customer.id);
  check(customer.cccd === '001234567890', 'CCCD keeps leading zero');
  check(customer.address === '12 Nguyễn Trãi', 'address is stored');
  check(customer.placeOfOrigin === 'Hà Nam', 'place of origin is stored');
  check(customer.sex === 'Nữ', 'sex is stored');
  check(customer.placeOfIssue === 'Cục Cảnh sát', 'place of issue is stored');

  const batchDb = await db.query(
    `SELECT "status","importedRows","duplicateRows","invalidRows","failedInsertRows","tempFileKey","failureDetailsExpiresAt",
            "totalRows","validRows","skippedRows","columnMapping","selectedSheet"
     FROM "CustomerImportBatch" WHERE "id" = $1`,
    [createdBatchId],
  );
  check(batchDb.rowCount === 1, 'batch exists in PostgreSQL');
  const storedBatch = batchDb.rows[0];
  check(storedBatch.status === 'COMPLETED', 'database batch status is COMPLETED');
  check(storedBatch.importedRows === 1 && storedBatch.duplicateRows === 1 && storedBatch.invalidRows === 1,
    'database counts match mixed-row result');
  check(storedBatch.tempFileKey === null, 'terminal batch clears temporary file key');
  check(storedBatch.totalRows === 0 && storedBatch.validRows === 0 && storedBatch.skippedRows === 0,
    'terminal batch clears aggregate staging fields');
  check(storedBatch.columnMapping && Object.keys(storedBatch.columnMapping).length === 0,
    'terminal batch clears column mapping');
  check(storedBatch.selectedSheet === null, 'terminal batch clears selected sheet');
  check(Boolean(storedBatch.failureDetailsExpiresAt), 'invalid-row retention is set');

  const failedRows = await responseJson(await fetch(`${baseUrl}/customers/import-batches/${createdBatchId}`, { headers }));
  check(failedRows.status === 200, 'batch detail route remains accessible');
  check(Array.isArray(failedRows.body.failedRows) && failedRows.body.failedRows.length === 1,
    'batch detail exposes only one sanitized invalid row');
  check(failedRows.body.failedRows[0].rowNumber === 4,
    'invalid row number is retained without PII');

  process.stdout.write('P0-4 mixed-row and optional-profile database integration: PASS\n');
} finally {
  await cleanup();
  await db.end();
}
