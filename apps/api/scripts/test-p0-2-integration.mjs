import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const baseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? '3001'}/api/v1`;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const databaseName = new URL(databaseUrl).pathname.toLowerCase();
if (process.env.NODE_ENV !== 'test' || !/(?:_test|_ci)(?:$|\?)/.test(databaseName)) {
  throw new Error('P0-2 integration tests require NODE_ENV=test and a database ending in _test or _ci');
}

const db = new pg.Client({ connectionString: databaseUrl });
const [parentBranchId, childBranchId, outsideBranchId, managerId, roleId, operatorId] = Array.from({ length: 6 }, randomUUID);
const createdCustomerIds = [];
let childManagerId = null;
const managerPassword = 'Ci-P0-2-Branch-Manager-Strong-9!';
const managerUsername = `ci_manager_${managerId.slice(0, 8)}`;
const operatorUsername = `ci_operator_${operatorId.slice(0, 8)}`;
const operatorPassword = `Ci-P0-2-Operator-${operatorId.slice(0, 8)}-Strong-9!`;
const check = (condition, label) => {
  if (!condition) throw new Error(`P0-2 integration assertion failed: ${label}`);
  process.stdout.write(`PASS ${label}\n`);
};

async function responseJson(response) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* preserve HTTP status for failure output */ }
  return { status: response.status, body };
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const result = await responseJson(response);
  if (result.status !== 201 && result.status !== 200) throw new Error(`Login failed with HTTP ${result.status}`);
  return result.body.accessToken;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(baseUrl.replace(/\/api\/v1$/, '/ready'));
      if (response.ok) return;
    } catch { /* API container is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('API did not become ready within 30 seconds');
}

async function createCustomer(token, fullName, phone, branchId) {
  const response = await fetch(`${baseUrl}/customers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fullName, phone, provenance: 'Automated P0-2 integration test', branchId }),
  });
  const result = await responseJson(response);
  check(result.status === 201, `staff creates ${fullName}`);
  createdCustomerIds.push(result.body.id);
  return result.body;
}

async function insertCustomer(id, fullName, branchId, createdById = null) {
  const phone = `0${(100000000 + createdCustomerIds.length).toString().padStart(9, '0')}`;
  await db.query(
    `INSERT INTO "Customer" ("id","fullName","normalizedName","phone","phoneNormalized","provenance","branchId","createdById","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,NOW(),NOW())`,
    [id, fullName, fullName.toLowerCase(), phone, 'CI integration fixture', branchId, createdById],
  );
  createdCustomerIds.push(id);
}

async function seedBranchManager() {
  const salt = randomBytes(16);
  const key = await promisify(scryptCallback)(managerPassword, salt, 64, {
    N: 32_768, r: 8, p: 1, maxmem: 128 * 1024 * 1024,
  });
  const passwordHash = `scrypt$32768$8$1$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
  await db.query(
    `INSERT INTO "Branch" ("id","code","name","status","createdAt","updatedAt") VALUES
     ($1,$2,'CI parent branch','INACTIVE',NOW(),NOW()),($3,$4,'CI child branch','INACTIVE',NOW(),NOW()),($5,$6,'CI outside branch','INACTIVE',NOW(),NOW())`,
    [parentBranchId, `CI-P-${parentBranchId.slice(0, 8)}`, childBranchId, `CI-C-${childBranchId.slice(0, 8)}`, outsideBranchId, `CI-O-${outsideBranchId.slice(0, 8)}`],
  );
  await db.query('UPDATE "Branch" SET "parentId" = $1 WHERE "id" = $2', [parentBranchId, childBranchId]);
  await db.query(
    `INSERT INTO "Role" ("id","key","name","description","isSystem","createdAt","updatedAt") VALUES ($1,$2,'CI branch reader','Temporary branch scope test',false,NOW(),NOW())`,
    [roleId, `CI_BRANCH_${roleId.slice(0, 8)}`],
  );
  await db.query('INSERT INTO "RolePermission" ("roleId","permissionKey","scope") VALUES ($1,\'customers.read\',\'BRANCH\')', [roleId]);
  await db.query(
    `INSERT INTO "User" ("id","username","displayName","passwordHash","status","mustChangePassword","passwordChangedAt","createdAt","updatedAt")
     VALUES ($1,$2,'CI Branch Manager',$3,'ACTIVE',false,NOW(),NOW(),NOW())`,
    [managerId, managerUsername, passwordHash],
  );
  await db.query(
    `INSERT INTO "UserRoleGrant" ("id","userId","roleId","branchId","scopeAnchor","createdAt") VALUES ($1,$2,$3,$4,$5,NOW())`,
    [randomUUID(), managerId, roleId, parentBranchId, parentBranchId],
  );
  const manageRole = await db.query('SELECT "id" FROM "Role" WHERE "key" = \'MANAGE\'');
  if (!manageRole.rowCount) throw new Error('MANAGE system role is missing; run db:seed before integration tests');
  await db.query('UPDATE "Branch" SET "managerUserId" = $1, "status" = \'ACTIVE\' WHERE "id" = $2', [managerId, parentBranchId]);
  await db.query('INSERT INTO "UserRoleGrant" ("id","userId","roleId","branchId","scopeAnchor","createdAt") VALUES ($1,$2,$3,$4,$5,NOW())',
    [randomUUID(), managerId, manageRole.rows[0].id, parentBranchId, parentBranchId]);
  const operatorRole = await db.query('SELECT "id" FROM "Role" WHERE "key" = \'OPERATOR\'');
  const operatorSalt = randomBytes(16);
  const operatorKey = await promisify(scryptCallback)(operatorPassword, operatorSalt, 64, { N: 32_768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const operatorHash = `scrypt$32768$8$1$${operatorSalt.toString('base64url')}$${Buffer.from(operatorKey).toString('base64url')}`;
  await db.query(`INSERT INTO "User" ("id","username","displayName","passwordHash","status","mustChangePassword","passwordChangedAt","createdAt","updatedAt")
    VALUES ($1,$2,'CI Operator',$3,'ACTIVE',false,NOW(),NOW(),NOW())`, [operatorId, operatorUsername, operatorHash]);
  await db.query('INSERT INTO "UserRoleGrant" ("id","userId","roleId","branchId","scopeAnchor","createdAt") VALUES ($1,$2,$3,NULL,\'GLOBAL\',NOW())', [randomUUID(), operatorId, operatorRole.rows[0].id]);
}

async function cleanup() {
  const branchIds = [parentBranchId, childBranchId, outsideBranchId];
  if (createdCustomerIds.length) {
    await db.query('DELETE FROM "ContractOtpChallenge" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "LoanContractStatusHistory" WHERE "contractId" IN (SELECT "id" FROM "LoanContract" WHERE "customerId" = ANY($1::uuid[]))', [createdCustomerIds]);
    await db.query('DELETE FROM "CustomerStatusHistory" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "CustomerAssignment" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "LoanRequest" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "LoanContract" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "DuplicateCandidate" WHERE "customerId" = ANY($1::uuid[]) OR "candidateCustomerId" = ANY($1::uuid[])', [createdCustomerIds]);
  }
  await db.query('DELETE FROM "AuditEvent" WHERE "branchId" = ANY($1::uuid[])', [branchIds]);
  if (createdCustomerIds.length) await db.query('DELETE FROM "Customer" WHERE "id" = ANY($1::uuid[])', [createdCustomerIds]);
  await db.query('UPDATE "Branch" SET "managerUserId" = NULL, "status" = \'INACTIVE\' WHERE "managerUserId" = $1', [managerId]);
  await db.query('DELETE FROM "UserRoleGrant" WHERE "userId" = $1', [managerId]);
  await db.query('DELETE FROM "User" WHERE "id" = $1', [managerId]);
  if (childManagerId) {
    await db.query('UPDATE "Branch" SET "managerUserId" = NULL, "status" = \'INACTIVE\' WHERE "managerUserId" = $1', [childManagerId]);
    await db.query('DELETE FROM "UserRoleGrant" WHERE "userId" = $1', [childManagerId]);
    await db.query('DELETE FROM "User" WHERE "id" = $1', [childManagerId]);
  }
  await db.query('DELETE FROM "UserRoleGrant" WHERE "userId" = $1', [operatorId]);
  await db.query('DELETE FROM "User" WHERE "id" = $1', [operatorId]);
  await db.query('DELETE FROM "Role" WHERE "id" = $1', [roleId]);
  await db.query('DELETE FROM "Branch" WHERE "id" = $1', [childBranchId]);
  await db.query('DELETE FROM "Branch" WHERE "id" = ANY($1::uuid[])', [[parentBranchId, outsideBranchId]]);
}

await db.connect();
try {
  await waitForApi();
  await seedBranchManager();
  const operatorToken = await login(operatorUsername, operatorPassword);
  const operatorHeaders = { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' };

  const childCustomerId = randomUUID();
  const outsideCustomerId = randomUUID();
  await insertCustomer(childCustomerId, 'CI Child Customer', childBranchId);
  await insertCustomer(outsideCustomerId, 'CI Outside Customer', outsideBranchId);

  const managerToken = await login(managerUsername, managerPassword);
  const managerHeaders = { authorization: `Bearer ${managerToken}` };
  const managerList = await responseJson(await fetch(`${baseUrl}/customers`, { headers: managerHeaders }));
  const visibleIds = managerList.body.map((customer) => customer.id);
  check(managerList.status === 200 && visibleIds.includes(childCustomerId), 'BRANCH grant includes descendant branch customer');
  check(!visibleIds.includes(outsideCustomerId), 'BRANCH grant excludes customer outside assigned branch tree');
  check((await fetch(`${baseUrl}/customers/${childCustomerId}`, { headers: managerHeaders })).status === 200, 'branch manager reads descendant customer detail');
  check((await fetch(`${baseUrl}/customers/${outsideCustomerId}`, { headers: managerHeaders })).status === 403, 'branch manager cannot read outside customer detail');
  const childWrite = await fetch(`${baseUrl}/customers/${childCustomerId}`, {
    method: 'PATCH', headers: { ...managerHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'Unauthorized child edit' }),
  });
  check(childWrite.status === 403, 'parent manager read scope does not grant child branch write access');
  const childCustomerCreate = await fetch(`${baseUrl}/customers`, {
    method: 'POST', headers: { ...managerHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Unauthorized child create', phone: '0912345679', provenance: 'CI', branchId: childBranchId }),
  });
  check(childCustomerCreate.status === 403, 'parent manager cannot create customers in a child branch');

  const first = await createCustomer(operatorToken, 'CI Duplicate Customer One', '+84 912-345-678', parentBranchId);
  check(first.phone === '0912345678', 'Vietnamese +84 input is stored in canonical local form');
  const invalid = await fetch(`${baseUrl}/customers`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ fullName: 'CI Invalid Phone', phone: '0012345678', provenance: 'Integration test', branchId: parentBranchId }),
  });
  check(invalid.status === 400, 'invalid Vietnamese phone prefix is rejected');
  const second = await createCustomer(operatorToken, 'CI Duplicate Customer Two', '0912345678', parentBranchId);

  const duplicateList = await responseJson(await fetch(`${baseUrl}/customers/${first.id}/duplicates`, { headers: operatorHeaders }));
  const duplicate = duplicateList.body.find((row) => row.candidateCustomerId === second.id);
  check(duplicateList.status === 200 && Boolean(duplicate), 'duplicate candidate is visible from source profile');
  const resolution = await fetch(`${baseUrl}/customers/${first.id}/duplicates/${duplicate.id}/resolve`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ status: 'NOT_DUPLICATE', reason: 'Separate automated test records' }),
  });
  check(resolution.status === 201, 'staff can resolve duplicate candidate with audit');

  const customerTokenResponse = await responseJson(await fetch(`${baseUrl}/auth/dev/customer-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerId: first.id }),
  }));
  check(customerTokenResponse.status === 201 || customerTokenResponse.status === 200, 'test CUSTOMER token issued');
  const customerHeaders = { authorization: `Bearer ${customerTokenResponse.body.accessToken}`, 'content-type': 'application/json' };
  const ownProfile = await responseJson(await fetch(`${baseUrl}/customers/${first.id}`, { headers: customerHeaders }));
  check(ownProfile.status === 200 && !('provenance' in ownProfile.body) && !('branchId' in ownProfile.body), 'CUSTOMER reads own allowlisted profile only');
  check((await fetch(`${baseUrl}/customers/${second.id}`, { headers: customerHeaders })).status === 403, 'CUSTOMER cannot read another profile');
  const ownRequest = await responseJson(await fetch(`${baseUrl}/loan-requests`, {
    method: 'POST', headers: customerHeaders, body: JSON.stringify({ customerId: first.id, topic: 'Own integration request' }),
  }));
  check(ownRequest.status === 201 && !('source' in ownRequest.body), 'CUSTOMER creates own request without internal source fields');
  check((await fetch(`${baseUrl}/loan-requests`, {
    method: 'POST', headers: customerHeaders, body: JSON.stringify({ customerId: second.id, topic: 'Foreign integration request' }),
  })).status === 403, 'CUSTOMER cannot create another customer request');

  const preContractStatus = await fetch(`${baseUrl}/customers/${first.id}/status`, {
    method: 'POST', headers: operatorHeaders, body: JSON.stringify({ status: 'CONVERTED', reason: 'Contract guard integration test' }),
  });
  check(preContractStatus.status === 409, 'CONVERTED is blocked before contract creation');
  const contract = await fetch(`${baseUrl}/loan-contracts`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ customerId: first.id, contractNumber: `CI-${first.id}`, packageName: 'CI package', loanType: 'Personal', termMonths: 12 }),
  });
  check(contract.status === 201, 'staff can register contract');
  const contractResult = await responseJson(contract);
  check(contractResult.status === 201 && contractResult.body.status === 'PENDING_REVIEW', 'new contract requires manager review');
  const approve = await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/approve`, { method: 'POST', headers: managerHeaders });
  check(approve.status === 201, 'direct branch manager approves a pending contract');
  const otpResponse = await responseJson(await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/request-completion-otp`, { method: 'POST', headers: managerHeaders }));
  check(otpResponse.status === 201 && otpResponse.body.status === 'AWAITING_CUSTOMER_CONFIRMATION' && Boolean(otpResponse.body.debugOtp), 'manager requests transaction-bound OTP');
  const completion = await responseJson(await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/confirm-completion`, {
    method: 'POST', headers: customerHeaders, body: JSON.stringify({ code: otpResponse.body.debugOtp }),
  }));
  check(completion.status === 201 && completion.body.status === 'COMPLETED', 'contract completes only after CUSTOMER OTP confirmation');
  const completedCustomer = await responseJson(await fetch(`${baseUrl}/customers/${first.id}`, { headers: operatorHeaders }));
  check(completedCustomer.body.status === 'CONVERTED', 'completion changes customer status to CONVERTED');

  const externalPayload = { sourceSystem: 'CI_SOURCE', externalContractId: `EXT-${first.id}`, contractNumber: `EXT-${first.id}`, packageCode: 'CI-PACKAGE', packageName: 'CI package', packageVersion: '1', loanType: 'Personal', termMonths: 12, customerFullName: first.fullName, customerPhone: first.phone, branchId: parentBranchId };
  const importHeaders = { ...managerHeaders, 'content-type': 'application/json', 'idempotency-key': `ci-key-${first.id}` };
  const imported = await responseJson(await fetch(`${baseUrl}/loan-contracts/external`, { method: 'POST', headers: importHeaders, body: JSON.stringify(externalPayload) }));
  check(imported.status === 201 && imported.body.status === 'PENDING_REVIEW' && imported.body.customerCreated === false, 'external contract links unambiguous existing customer');
  const replay = await responseJson(await fetch(`${baseUrl}/loan-contracts/external`, { method: 'POST', headers: importHeaders, body: JSON.stringify(externalPayload) }));
  check(replay.status === 201 && replay.body.id === imported.body.id && replay.body.replayed === true, 'external contract import is idempotent');
  const conflict = await responseJson(await fetch(`${baseUrl}/loan-contracts/external`, { method: 'POST', headers: importHeaders, body: JSON.stringify({ ...externalPayload, packageName: 'Changed package' }) }));
  check(conflict.status === 409, 'idempotency rejects altered payload for existing source contract');
  for (let index = 0; index < 20; index++) {
    const item = { ...externalPayload, externalContractId: `EXT-${first.id}-${index}`, contractNumber: `EXT-${first.id}-${index}` };
    const response = await fetch(`${baseUrl}/loan-contracts/external`, { method: 'POST', headers: { ...managerHeaders, 'content-type': 'application/json', 'idempotency-key': `ci-key-${first.id}-${index}` }, body: JSON.stringify(item) });
    check(response.status === 201, `external contract pagination fixture ${index + 1}`);
  }
  const contractPage = await responseJson(await fetch(`${baseUrl}/loan-contracts?customerId=${first.id}`, { headers: managerHeaders }));
  check(contractPage.status === 200 && contractPage.body.items.length <= 20 && Boolean(contractPage.body.nextCursor), 'contract list is limited to 20 records per cursor page');
  const adviser = await responseJson(await fetch(`${baseUrl}/access/users`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ username: `ci_child_adviser_${childBranchId.slice(0, 8)}`, displayName: 'CI Child Adviser', temporaryPassword: 'Ci-P0-2-Child-Adviser-Strong-9!', roleKey: 'ADVISING', branchId: childBranchId }),
  }));
  check(adviser.status === 201, 'operator creates branch adviser for manager assignment test');
  childManagerId = adviser.body.id;
  const childManager = await responseJson(await fetch(`${baseUrl}/access/branches/${childBranchId}/manager`, {
    method: 'PUT', headers: operatorHeaders, body: JSON.stringify({ managerUserId: adviser.body.id }),
  }));
  check(childManager.status === 200 && childManager.body.managerUserId === adviser.body.id, 'manager assignment endpoint activates branch and sets its single manager');
  process.stdout.write('P0-2 API/PostgreSQL integration tests passed.\n');
} finally {
  await cleanup();
  await db.end();
}
