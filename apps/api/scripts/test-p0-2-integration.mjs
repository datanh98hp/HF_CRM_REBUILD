import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const baseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? '3001'}/api/v1`;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const databaseName = new URL(databaseUrl).pathname.toLowerCase();
const contractAssetsDirectory = fileURLToPath(new URL('../src/Assets/contracts/', import.meta.url));
if (process.env.NODE_ENV !== 'test' || !/(?:_test|_ci)(?:$|\?)/.test(databaseName)) {
  throw new Error('P0-2 integration tests require NODE_ENV=test and a database ending in _test or _ci');
}

const db = new pg.Client({ connectionString: databaseUrl });
const [parentBranchId, childBranchId, outsideBranchId, managerId, roleId, operatorId] = Array.from({ length: 6 }, randomUUID);
const createdCustomerIds = [];
const createdLoanProductIds = [];
let childManagerId = null;
let bulkAdviserUserId = null;
const managerPassword = 'Ci-P0-2-Branch-Manager-Strong-9!';
const managerUsername = `ci_manager_${managerId.slice(0, 8)}`;
const operatorUsername = `ci_operator_${operatorId.slice(0, 8)}`;
const operatorPassword = `Ci-P0-2-Operator-${operatorId.slice(0, 8)}-Strong-9!`;
const childManagerPassword = 'Ci-P0-2-Child-Adviser-Strong-9!';
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
    const storedContractFiles = await db.query(
      `SELECT "storageKey" FROM "LoanContractDocument"
       WHERE "contractId" IN (SELECT "id" FROM "LoanContract" WHERE "customerId" = ANY($1::uuid[]))`,
      [createdCustomerIds],
    );
    for (const row of storedContractFiles.rows) {
      try {
        await unlink(join(contractAssetsDirectory, row.storageKey));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    await db.query('DELETE FROM "LoanContractChangeHistory" WHERE "contractId" IN (SELECT "id" FROM "LoanContract" WHERE "customerId" = ANY($1::uuid[]))', [createdCustomerIds]);
    await db.query('DELETE FROM "LoanContractDocument" WHERE "contractId" IN (SELECT "id" FROM "LoanContract" WHERE "customerId" = ANY($1::uuid[]))', [createdCustomerIds]);
    await db.query('DELETE FROM "ContractOtpChallenge" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "LoanContractStatusHistory" WHERE "contractId" IN (SELECT "id" FROM "LoanContract" WHERE "customerId" = ANY($1::uuid[]))', [createdCustomerIds]);
    await db.query('DELETE FROM "CustomerStatusHistory" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "CustomerAssignment" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "LoanContract" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "LoanRequest" WHERE "customerId" = ANY($1::uuid[])', [createdCustomerIds]);
    await db.query('DELETE FROM "DuplicateCandidate" WHERE "customerId" = ANY($1::uuid[]) OR "candidateCustomerId" = ANY($1::uuid[])', [createdCustomerIds]);
  }
  if (createdLoanProductIds.length) {
    await db.query('DELETE FROM "LoanProductFormulaVersion" WHERE "productId" = ANY($1::uuid[])', [createdLoanProductIds]);
    await db.query('DELETE FROM "LoanProduct" WHERE "id" = ANY($1::uuid[])', [createdLoanProductIds]);
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
  if (bulkAdviserUserId) {
    await db.query('DELETE FROM "UserRoleGrant" WHERE "userId" = $1', [bulkAdviserUserId]);
    await db.query('DELETE FROM "User" WHERE "id" = $1', [bulkAdviserUserId]);
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
  const capabilities = await responseJson(await fetch(`${baseUrl}/capabilities`));
  check(capabilities.status === 200 && capabilities.body.contractCompletionOtp.status === 'DEFERRED' && capabilities.body.contractCompletionOtp.ready === false,
    'frontend capability endpoint reports deferred CUSTOMER OTP without provider configuration');
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
  const selfReviewContract = await responseJson(await fetch(`${baseUrl}/loan-contracts`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ customerId: second.id, contractNumber: `CI-SELF-REVIEW-${second.id}`, packageName: 'Global self-review test contract' }),
  }));
  check(selfReviewContract.status === 201, 'global reviewer creates a contract for self-review test');
  const creatorApprove = await fetch(`${baseUrl}/loan-contracts/${selfReviewContract.body.id}/approve`, { method: 'POST', headers: operatorHeaders });
  check(creatorApprove.status === 201, 'global reviewer can approve a contract they created');
  const managerCreatedContract = await responseJson(await fetch(`${baseUrl}/loan-contracts`, {
    method: 'POST', headers: { ...managerHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: second.id, contractNumber: `CI-OPERATOR-REVIEW-${second.id}`, packageName: 'Manager-created test contract' }),
  }));
  check(managerCreatedContract.status === 201,
    `branch manager can create a contract in the assigned branch (HTTP ${managerCreatedContract.status}, ${managerCreatedContract.body.code ?? 'no error code'})`);
  const operatorApprove = await fetch(`${baseUrl}/loan-contracts/${managerCreatedContract.body.id}/approve`, { method: 'POST', headers: operatorHeaders });
  check(operatorApprove.status === 201, 'global OPERATOR approves another user’s contract');

  const pdfContents = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF', 'utf8');
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([pdfContents], { type: 'application/pdf' }), `agreement-${first.id}.pdf`);
  const uploadedDocument = await responseJson(await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/documents`, {
    method: 'POST', headers: { authorization: managerHeaders.authorization }, body: uploadForm,
  }));
  check(uploadedDocument.status === 201 && uploadedDocument.body.fileName === `agreement-${first.id}.pdf`, 'manager uploads a supported contract document');
  const invalidDocumentForm = new FormData();
  invalidDocumentForm.append('file', new Blob([Buffer.from('not a PDF')], { type: 'application/pdf' }), 'invalid.pdf');
  const invalidDocument = await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/documents`, {
    method: 'POST', headers: { authorization: managerHeaders.authorization }, body: invalidDocumentForm,
  });
  check(invalidDocument.status === 400, 'contract document upload rejects content with an invalid file signature');
  const replacementForm = new FormData();
  replacementForm.append('file', new Blob([pdfContents], { type: 'application/pdf' }), `agreement-updated-${first.id}.pdf`);
  const replacedDocument = await responseJson(await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/documents/${uploadedDocument.body.id}`, {
    method: 'PUT', headers: { authorization: managerHeaders.authorization }, body: replacementForm,
  }));
  check(replacedDocument.status === 200 && replacedDocument.body.fileName === `agreement-updated-${first.id}.pdf`, 'manager replaces a contract document and preserves its prior version');
  const contractDocuments = await responseJson(await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/documents`, { headers: managerHeaders }));
  check(contractDocuments.status === 200 && contractDocuments.body.length === 1 && contractDocuments.body[0].id === replacedDocument.body.id, 'contract document list excludes replaced versions');
  const downloadedDocument = await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/documents/${replacedDocument.body.id}/download`, { headers: managerHeaders });
  check(downloadedDocument.status === 200 && (await downloadedDocument.arrayBuffer()).byteLength === pdfContents.length, 'contract documents download through an authenticated endpoint');
  const deletedDocument = await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/documents/${replacedDocument.body.id}`, {
    method: 'DELETE', headers: managerHeaders,
  });
  check(deletedDocument.status === 200, 'contract document is soft-deleted after confirmation at the UI');
  const documentsAfterDelete = await responseJson(await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/documents`, { headers: managerHeaders }));
  check(documentsAfterDelete.status === 200 && documentsAfterDelete.body.length === 0, 'soft-deleted contract document is hidden from the active list');
  const contractHistory = await responseJson(await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/history`, { headers: managerHeaders }));
  check(contractHistory.status === 200
    && ['DOCUMENT_UPLOADED', 'DOCUMENT_REPLACED', 'DOCUMENT_SOFT_DELETED'].every((action) => contractHistory.body.items.some((item) => item.action === action)),
  'contract history records each document upload, replacement and soft delete');

  const approve = await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/approve`, { method: 'POST', headers: managerHeaders });
  check(approve.status === 201, 'direct branch manager approves a pending contract');
  const customerAfterApproval = await db.query('SELECT "status" FROM "Customer" WHERE "id" = $1', [first.id]);
  check(customerAfterApproval.rows[0]?.status === 'CONVERTED', 'approving a contract immediately converts its customer');
  const approvalStatusHistory = await db.query(
    'SELECT "changedById", "changedByCustomerId" FROM "CustomerStatusHistory" WHERE "customerId" = $1 AND "toStatus" = \'CONVERTED\' ORDER BY "createdAt" LIMIT 1',
    [first.id],
  );
  check(approvalStatusHistory.rows[0]?.changedById === managerId && approvalStatusHistory.rows[0]?.changedByCustomerId === null,
    'automatic customer conversion history records the contract approver');
  const otpResponse = await responseJson(await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/request-completion-otp`, { method: 'POST', headers: managerHeaders }));
  check(otpResponse.status === 201 && otpResponse.body.status === 'AWAITING_CUSTOMER_CONFIRMATION' && Boolean(otpResponse.body.debugOtp), 'manager requests transaction-bound OTP');
  const completion = await responseJson(await fetch(`${baseUrl}/loan-contracts/${contractResult.body.id}/confirm-completion`, {
    method: 'POST', headers: customerHeaders, body: JSON.stringify({ code: otpResponse.body.debugOtp }),
  }));
  check(completion.status === 201 && completion.body.status === 'COMPLETED', 'contract completes only after CUSTOMER OTP confirmation');
  const contractActor = await db.query('SELECT "changedByCustomerId" FROM "LoanContractStatusHistory" WHERE "contractId" = $1 AND "toStatus" = \'COMPLETED\'', [contractResult.body.id]);
  check(contractActor.rows[0]?.changedByCustomerId === first.id, 'contract status history records CUSTOMER OTP actor');
  const customerStatusActor = await db.query('SELECT "changedById", "changedByCustomerId" FROM "CustomerStatusHistory" WHERE "customerId" = $1 AND "toStatus" = \'CONVERTED\'', [first.id]);
  check(customerStatusActor.rows[0]?.changedById === managerId && customerStatusActor.rows[0]?.changedByCustomerId === null,
    'OTP completion does not duplicate the conversion history created by contract approval');
  const phoneVerification = await db.query('SELECT "phoneVerifiedAt", "verificationStatus" FROM "Customer" WHERE "id" = $1', [first.id]);
  check(Boolean(phoneVerification.rows[0]?.phoneVerifiedAt) && phoneVerification.rows[0]?.verificationStatus === 'UNVERIFIED', 'successful OTP verifies phone without overstating full customer verification');
  const completedCustomer = await responseJson(await fetch(`${baseUrl}/customers/${first.id}`, { headers: operatorHeaders }));
  check(completedCustomer.body.status === 'CONVERTED', 'customer remains converted after OTP contract completion');

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
  const contractPage = await responseJson(await fetch(`${baseUrl}/loan-contracts?customerId=${first.id}&pageSize=10`, { headers: managerHeaders }));
  check(contractPage.status === 200 && contractPage.body.pageSize === 10 && contractPage.body.items.length <= 10 && Boolean(contractPage.body.nextCursor), 'contract list honors a custom cursor page size');
  const searchedContracts = await responseJson(await fetch(`${baseUrl}/loan-contracts?customerId=${first.id}&search=${encodeURIComponent(contractResult.body.contractNumber.slice(0, 8).toLowerCase())}`, { headers: managerHeaders }));
  check(searchedContracts.status === 200
    && searchedContracts.body.items.length === 1
    && searchedContracts.body.items[0].contractNumber === contractResult.body.contractNumber
    && searchedContracts.body.items[0].branchName === 'CI parent branch',
  'contract search is case-insensitive and returns the branch name');
  const invalidContractPageSize = await fetch(`${baseUrl}/loan-contracts?pageSize=101`, { headers: managerHeaders });
  check(invalidContractPageSize.status === 400, 'contract list rejects page sizes above the configured limit');
  const adviser = await responseJson(await fetch(`${baseUrl}/access/users`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ username: `ci_child_adviser_${childBranchId.slice(0, 8)}`, displayName: 'CI Child Adviser', temporaryPassword: childManagerPassword, roleKey: 'ADVISING', branchId: childBranchId }),
  }));
  check(adviser.status === 201, 'operator creates branch adviser for manager assignment test');
  childManagerId = adviser.body.id;
  const childManager = await responseJson(await fetch(`${baseUrl}/access/branches/${childBranchId}/manager`, {
    method: 'PUT', headers: operatorHeaders, body: JSON.stringify({ managerUserId: adviser.body.id }),
  }));
  check(childManager.status === 200 && childManager.body.managerUserId === adviser.body.id, 'manager assignment endpoint activates branch and sets its single manager');
  const childManagerToken = await login(adviser.body.username, childManagerPassword);
  const passwordChange = await responseJson(await fetch(`${baseUrl}/auth/password`, {
    method: 'POST',
    headers: { authorization: `Bearer ${childManagerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      currentPassword: childManagerPassword,
      newPassword: 'Ci-P0-2-Child-Manager-Changed-Strong-9!',
    }),
  }));
  check((passwordChange.status === 200 || passwordChange.status === 201) && Boolean(passwordChange.body.accessToken),
    `new branch manager completes required password change (HTTP ${passwordChange.status}, ${passwordChange.body.code ?? 'no error code'})`);
  const childManagerHeaders = { authorization: `Bearer ${passwordChange.body.accessToken}` };
  const childContract = await responseJson(await fetch(`${baseUrl}/loan-contracts`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ customerId: childCustomerId, contractNumber: `CI-CHILD-BRANCH-${childCustomerId}`, packageName: 'Child branch test contract' }),
  }));
  check(childContract.status === 201, 'global operator creates a contract for a customer in a child branch');
  const parentManagerChildApprove = await fetch(`${baseUrl}/loan-contracts/${childContract.body.id}/approve`, { method: 'POST', headers: managerHeaders });
  check(parentManagerChildApprove.status === 403, 'parent branch manager cannot approve a child branch contract');
  const childManagerApprove = await responseJson(await fetch(`${baseUrl}/loan-contracts/${childContract.body.id}/approve`, {
    method: 'POST', headers: childManagerHeaders,
  }));
  check(childManagerApprove.status === 201,
    `manager assigned to the child branch can approve its contract (HTTP ${childManagerApprove.status}, ${childManagerApprove.body.code ?? 'no error code'})`);

  const product = await responseJson(await fetch(`${baseUrl}/loan-products`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ branchId: parentBranchId, code: `CI-${first.id.slice(0, 8)}`, name: 'CI Integration Loan Product', loanType: 'Gói hỗ trợ ngắn hạn', source: 'Synthetic integration fixture', description: 'Fixed snapshot description for the approved contract.', minTermMonths: 6, maxTermMonths: 36, minAmount: '1000000.00', maxAmount: '50000000.00', annualInterestRate: '12.0000' }),
  }));
  check(product.status === 201, 'operator creates a branch-scoped loan product');
  createdLoanProductIds.push(product.body.id);
  const formula = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/formula`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ interestFormula: 'principal * annualRatePercent / 100', monthlyPaymentFormula: 'principal / termMonths', variables: [] }),
  }));
  check(formula.status === 201 && formula.body.version === 1, 'operator saves immutable formula version one');
  const publishedProduct = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/status`, {
    method: 'POST', headers: operatorHeaders, body: JSON.stringify({ status: 'ACTIVE' }),
  }));
  check(publishedProduct.status === 201 && publishedProduct.body.status === 'ACTIVE', 'product can only be published after a formula exists');
  const formulaInputs = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/formula-inputs`, { headers: operatorHeaders }));
  check(formulaInputs.status === 200 && formulaInputs.body.version === 1 && Array.isArray(formulaInputs.body.variables) && !('interestFormula' in formulaInputs.body), `contract staff receive bounded formula input metadata without formula expressions (HTTP ${formulaInputs.status}, ${JSON.stringify(formulaInputs.body)})`);
  const customerProducts = await responseJson(await fetch(`${baseUrl}/loan-products`, { headers: customerHeaders }));
  check(customerProducts.status === 200 && customerProducts.body.some((item) => item.id === product.body.id), 'CUSTOMER sees an active product in their branch');
  const invalidProductRequest = await fetch(`${baseUrl}/loan-requests`, {
    method: 'POST', headers: customerHeaders,
    body: JSON.stringify({ customerId: first.id, productId: product.body.id, requestedAmount: '500000.00', requestedTermMonths: 12, notes: 'Out of range' }),
  });
  check(invalidProductRequest.status === 400, 'loan request enforces product amount and term limits');
  const productRequest = await responseJson(await fetch(`${baseUrl}/loan-requests`, {
    method: 'POST', headers: customerHeaders,
    body: JSON.stringify({ customerId: first.id, productId: product.body.id, requestedAmount: '12000000.00', requestedTermMonths: 12, notes: 'Product-based request' }),
  }));
  check(productRequest.status === 201 && productRequest.body.topic === product.body.name && productRequest.body.requestedAmount === '12000000.00' && productRequest.body.requestedTermMonths === 12, 'CUSTOMER creates a product request with amount, term and optional topic');
  const customerContract = await fetch(`${baseUrl}/loan-contracts`, {
    method: 'POST', headers: customerHeaders,
    body: JSON.stringify({ customerId: first.id, loanRequestId: productRequest.body.id, contractNumber: `CI-CUSTOMER-${first.id}`, loanAmount: '12000000.00', termMonths: 12 }),
  });
  check(customerContract.status === 403, 'CUSTOMER cannot create a contract from a loan request');
  const productContract = await responseJson(await fetch(`${baseUrl}/loan-contracts`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ customerId: first.id, loanRequestId: productRequest.body.id, contractNumber: `CI-PRODUCT-${first.id}` }),
  }));
  check(productContract.status === 201
    && productContract.body.status === 'PENDING_REVIEW'
    && productContract.body.packageCode === product.body.code
    && productContract.body.monthlyPayment === '1000000.00'
    && productContract.body.loanProduct?.name === product.body.name
    && productContract.body.loanProduct?.description === 'Fixed snapshot description for the approved contract.'
    && productContract.body.loanProduct?.annualInterestRate === '12.0000',
  'staff creates a pending contract with server-calculated terms and product details from its snapshot');
  const pendingContracts = await responseJson(await fetch(`${baseUrl}/loan-contracts?status=PENDING_REVIEW&branchId=${parentBranchId}`, { headers: operatorHeaders }));
  check(pendingContracts.status === 200 && pendingContracts.body.items.some((item) => item.id === productContract.body.id && item.customerName === first.fullName) && pendingContracts.body.items.every((item) => item.status === 'PENDING_REVIEW'), 'contract management list filters by status and branch and includes customer name');
  const completedContracts = await responseJson(await fetch(`${baseUrl}/loan-contracts?status=COMPLETED&branchId=${parentBranchId}`, { headers: operatorHeaders }));
  check(completedContracts.status === 200 && completedContracts.body.items.some((item) => item.id === contractResult.body.id) && completedContracts.body.items.every((item) => item.status === 'COMPLETED'), 'contract management status filter excludes pending reviews');
  const savedSnapshot = await db.query('SELECT "formulaVersionId", "packageVersion", "formulaSnapshot", "formulaInputs", "formulaOutputs" FROM "LoanContract" WHERE "id" = $1', [productContract.body.id]);
  check(savedSnapshot.rows[0]?.packageVersion === '1' && savedSnapshot.rows[0]?.formulaSnapshot?.formula?.version === 1 && Boolean(savedSnapshot.rows[0]?.formulaVersionId), 'contract persists immutable product and formula snapshot');
  const managerProductApprove = await fetch(`${baseUrl}/loan-contracts/${productContract.body.id}/approve`, { method: 'POST', headers: managerHeaders });
  check(managerProductApprove.status === 201, 'direct branch manager approves the product-based contract');

  const secondFormulaVersion = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/formula`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ interestFormula: 'principal * annualRatePercent / 100', monthlyPaymentFormula: 'principal / termMonths + 1', variables: [] }),
  }));
  check(secondFormulaVersion.status === 201 && secondFormulaVersion.body.version === 2, 'formula edits create a new immutable version');
  const formulaHistory = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/formula-versions`, { headers: operatorHeaders }));
  check(formulaHistory.status === 200
    && formulaHistory.body.items.map((item) => item.version).join(',') === '2,1'
    && formulaHistory.body.items[0].monthlyPaymentFormula === 'principal / termMonths + 1'
    && Boolean(formulaHistory.body.items[0].createdBy?.displayName),
  'formula history returns newest versions first with author and formula details');
  const earlierFormulaHistory = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/formula-versions?beforeVersion=2`, { headers: operatorHeaders }));
  check(earlierFormulaHistory.status === 200
    && earlierFormulaHistory.body.items.map((item) => item.version).join(',') === '1'
    && earlierFormulaHistory.body.nextBeforeVersion === null,
  'formula history cursor returns only older versions');
  const reappliedFormulaVersion = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/formula`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({
      interestFormula: formula.body.interestFormula,
      monthlyPaymentFormula: formula.body.monthlyPaymentFormula,
      variables: formula.body.variables,
    }),
  }));
  check(reappliedFormulaVersion.status === 201
    && reappliedFormulaVersion.body.version === 3
    && reappliedFormulaVersion.body.monthlyPaymentFormula === 'principal / termMonths',
  'reapplying an older formula creates a new immutable version');
  const historyAfterReapply = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/formula-versions`, { headers: operatorHeaders }));
  check(historyAfterReapply.status === 200
    && historyAfterReapply.body.items.map((item) => item.version).join(',') === '3,2,1'
    && historyAfterReapply.body.items[0].monthlyPaymentFormula === 'principal / termMonths',
  'reapplied formula becomes current while earlier versions remain in history');
  const invalidFormulaHistoryCursor = await fetch(`${baseUrl}/loan-products/${product.body.id}/formula-versions?beforeVersion=0`, { headers: operatorHeaders });
  check(invalidFormulaHistoryCursor.status === 400, 'formula history rejects invalid version cursors');
  const customerFormulaHistory = await fetch(`${baseUrl}/loan-products/${product.body.id}/formula-versions`, { headers: customerHeaders });
  check(customerFormulaHistory.status === 403, 'formula history requires formula management permission');

  const inactiveProduct = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/status`, {
    method: 'POST', headers: operatorHeaders, body: JSON.stringify({ status: 'INACTIVE' }),
  }));
  check(inactiveProduct.status === 201 && inactiveProduct.body.status === 'INACTIVE', 'published product can be deactivated');
  const productsAfterDeactivation = await responseJson(await fetch(`${baseUrl}/loan-products`, { headers: customerHeaders }));
  check(productsAfterDeactivation.status === 200 && !productsAfterDeactivation.body.some((item) => item.id === product.body.id), 'CUSTOMER no longer sees a deactivated product');
  const inactiveFormulaInputs = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/formula-inputs`, { headers: operatorHeaders }));
  check(inactiveFormulaInputs.status === 409 && inactiveFormulaInputs.body.code === 'LOAN_PRODUCT_NOT_ACTIVE', 'inactive product cannot provide contract formula inputs');
  const inactiveCalculation = await responseJson(await fetch(`${baseUrl}/loan-products/${product.body.id}/calculate`, {
    method: 'POST', headers: operatorHeaders, body: JSON.stringify({ principal: '12000000.00', termMonths: 12 }),
  }));
  check(inactiveCalculation.status === 409 && inactiveCalculation.body.code === 'LOAN_PRODUCT_NOT_ACTIVE', 'inactive product cannot be used for a calculation');
  const inactiveRequest = await responseJson(await fetch(`${baseUrl}/loan-requests`, {
    method: 'POST', headers: customerHeaders,
    body: JSON.stringify({ customerId: first.id, productId: product.body.id, requestedAmount: '12000000.00', requestedTermMonths: 12 }),
  }));
  check(inactiveRequest.status === 409 && inactiveRequest.body.code === 'LOAN_PRODUCT_NOT_ACTIVE', 'inactive product cannot be used for a new loan request');
  const inactiveContract = await responseJson(await fetch(`${baseUrl}/loan-contracts`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ customerId: first.id, loanRequestId: productRequest.body.id, contractNumber: `CI-INACTIVE-${first.id}` }),
  }));
  check(inactiveContract.status === 409 && inactiveContract.body.code === 'LOAN_PRODUCT_NOT_ACTIVE', 'inactive product cannot be used to create a contract');
  const preservedSnapshot = await db.query('SELECT "formulaVersionId", "formulaSnapshot", "formulaInputs", "formulaOutputs", "monthlyPayment" FROM "LoanContract" WHERE "id" = $1', [productContract.body.id]);
  check(preservedSnapshot.rows[0]?.formulaVersionId === savedSnapshot.rows[0]?.formulaVersionId
    && preservedSnapshot.rows[0]?.formulaSnapshot?.formula?.version === 1
    && preservedSnapshot.rows[0]?.formulaSnapshot?.formula?.monthlyPaymentFormula === 'principal / termMonths'
    && preservedSnapshot.rows[0]?.formulaInputs?.principal === '12000000.00'
    && preservedSnapshot.rows[0]?.monthlyPayment === '1000000.00',
  'new formula versions and product deactivation preserve the existing contract snapshot');

  const concurrentProduct = await responseJson(await fetch(`${baseUrl}/loan-products`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ branchId: parentBranchId, code: `CI-RACE-${first.id.slice(0, 8)}`, name: 'CI Concurrent Formula Product', loanType: 'Gói hỗ trợ ngắn hạn', source: 'Synthetic integration fixture', minTermMonths: 6, maxTermMonths: 36, minAmount: '1000000.00', maxAmount: '50000000.00', annualInterestRate: '12.0000' }),
  }));
  check(concurrentProduct.status === 201, 'operator creates a product for concurrent formula version test');
  createdLoanProductIds.push(concurrentProduct.body.id);
  const formulaPayload = { interestFormula: 'principal * annualRatePercent / 100', monthlyPaymentFormula: 'principal / termMonths', variables: [] };
  const concurrentFormulaResults = await Promise.all([1, 2].map(() => fetch(`${baseUrl}/loan-products/${concurrentProduct.body.id}/formula`, {
    method: 'POST', headers: operatorHeaders, body: JSON.stringify(formulaPayload),
  }).then(responseJson)));
  const concurrentFormulaSummary = concurrentFormulaResults.map(({ status, body }) => ({ status, code: body.code }));
  const successfulVersions = concurrentFormulaResults
    .filter(({ status }) => status === 201)
    .map(({ body }) => body.version)
    .sort((left, right) => left - right);
  const serializedVersions = successfulVersions.length === 2
    && successfulVersions[0] === 1
    && successfulVersions[1] === 2;
  const staleWriterRejected = successfulVersions.length === 1
    && successfulVersions[0] === 1
    && concurrentFormulaResults.some(({ status, body }) => status === 409 && body.code === 'LOAN_PRODUCT_FORMULA_VERSION_CHANGED');
  check(serializedVersions || staleWriterRejected,
    `concurrent formula edits preserve sequential versions (${JSON.stringify(concurrentFormulaSummary)})`);
  const concurrentFormulaState = await db.query(
    'SELECT p."currentFormulaVersion", COUNT(f."id")::int AS "formulaCount" FROM "LoanProduct" p LEFT JOIN "LoanProductFormulaVersion" f ON f."productId" = p."id" WHERE p."id" = $1 GROUP BY p."id"',
    [concurrentProduct.body.id],
  );
  check(concurrentFormulaState.rows[0]?.currentFormulaVersion === concurrentFormulaState.rows[0]?.formulaCount
    && concurrentFormulaState.rows[0]?.formulaCount === successfulVersions.length,
  'concurrent formula edits leave a contiguous immutable version history');

  const noAmountLimitsProduct = await responseJson(await fetch(`${baseUrl}/loan-products`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ branchId: parentBranchId, name: 'CI Product Without Amount Limits', loanType: 'Gói hỗ trợ mua sắm tiêu dùng', source: 'Synthetic integration fixture', minTermMonths: 1, maxTermMonths: 12, annualInterestRate: '12.0000' }),
  }));
  check(noAmountLimitsProduct.status === 201
    && noAmountLimitsProduct.body.code.startsWith('LP-')
    && noAmountLimitsProduct.body.minAmount === null
    && noAmountLimitsProduct.body.maxAmount === null,
  'product can omit its abbreviation and both amount limits');
  createdLoanProductIds.push(noAmountLimitsProduct.body.id);
  const noLimitFormula = await responseJson(await fetch(`${baseUrl}/loan-products/${noAmountLimitsProduct.body.id}/formula`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify(formulaPayload),
  }));
  check(noLimitFormula.status === 201 && noLimitFormula.body.version === 1, 'operator configures a formula for the product without amount limits');
  const publishNoLimitProduct = await responseJson(await fetch(`${baseUrl}/loan-products/${noAmountLimitsProduct.body.id}/status`, {
    method: 'POST', headers: operatorHeaders, body: JSON.stringify({ status: 'ACTIVE' }),
  }));
  check(publishNoLimitProduct.status === 201 && publishNoLimitProduct.body.status === 'ACTIVE', 'product without amount limits can be published');
  const lowAmountRequest = await responseJson(await fetch(`${baseUrl}/loan-requests`, {
    method: 'POST', headers: customerHeaders,
    body: JSON.stringify({ customerId: first.id, productId: noAmountLimitsProduct.body.id, requestedAmount: '1000.00', requestedTermMonths: 1 }),
  }));
  check(lowAmountRequest.status === 201, 'product request skips amount checks when both bounds are omitted');
  const lowAmountContract = await responseJson(await fetch(`${baseUrl}/loan-contracts`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ customerId: first.id, loanRequestId: lowAmountRequest.body.id, contractNumber: `CI-NO-LIMIT-${first.id}` }),
  }));
  check(lowAmountContract.status === 201 && lowAmountContract.body.loanAmount === '1000.00', 'contract creation skips omitted amount bounds');

  const bulkAdviser = await responseJson(await fetch(`${baseUrl}/access/users`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ username: `ci_bulk_adviser_${childBranchId.slice(0, 8)}`, displayName: 'CI Bulk Adviser', temporaryPassword: 'Ci-P0-2-Bulk-Adviser-Strong-9!', roleKey: 'ADVISING', branchId: childBranchId }),
  }));
  check(bulkAdviser.status === 201, 'operator creates a branch adviser dedicated to bulk assignment');
  bulkAdviserUserId = bulkAdviser.body.id;

  const secondChildCustomerId = randomUUID();
  const pendingChildCustomerId = randomUUID();
  await insertCustomer(secondChildCustomerId, 'CI Second Child Customer', childBranchId);
  await insertCustomer(pendingChildCustomerId, 'CI Pending Child Customer', childBranchId);
  const bulkAssignment = await responseJson(await fetch(`${baseUrl}/customers/assignments/bulk`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ customerIds: [childCustomerId, secondChildCustomerId], adviserId: bulkAdviserUserId }),
  }));
  check(bulkAssignment.status === 201 && bulkAssignment.body.assignedCount === 2, `bulk assignment assigns multiple customers to one active branch adviser (HTTP ${bulkAssignment.status}, ${JSON.stringify(bulkAssignment.body)})`);
  const assignmentRows = await db.query('SELECT COUNT(*)::int AS count FROM "CustomerAssignment" WHERE "customerId" = ANY($1::uuid[]) AND "endedAt" IS NULL AND "adviserId" = $2', [[childCustomerId, secondChildCustomerId], bulkAdviserUserId]);
  check(assignmentRows.rows[0].count === 2, 'bulk assignment persists one active assignment for every selected customer');

  const rejectedBulk = await responseJson(await fetch(`${baseUrl}/customers/assignments/bulk`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ customerIds: [pendingChildCustomerId, outsideCustomerId], adviserId: bulkAdviserUserId, reason: 'Mixed branch batch must be rejected' }),
  }));
  check(rejectedBulk.status === 400, 'bulk assignment rejects a batch when adviser is not eligible for every customer branch');
  const partialAssignment = await db.query('SELECT COUNT(*)::int AS count FROM "CustomerAssignment" WHERE "customerId" = $1 AND "endedAt" IS NULL', [pendingChildCustomerId]);
  check(partialAssignment.rows[0].count === 0, 'rejected bulk assignment leaves every customer unchanged');
  const singleAssignment = await responseJson(await fetch(`${baseUrl}/customers/${pendingChildCustomerId}/assignments`, {
    method: 'POST', headers: operatorHeaders,
    body: JSON.stringify({ adviserId: bulkAdviserUserId }),
  }));
  check(singleAssignment.status === 201, 'single-customer assignment accepts a missing reason');
  process.stdout.write('P0-2 API/PostgreSQL integration tests passed.\n');
} finally {
  await cleanup();
  await db.end();
}
