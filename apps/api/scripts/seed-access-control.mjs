import { config as loadDotEnv } from 'dotenv';
import { scrypt as scryptCallback, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  AccessScope,
  BranchStatus,
  CustomerStatus,
  CustomerVerificationStatus,
  DuplicateReviewStatus,
  LoanContractStatus,
  LoanRequestSource,
  LoanRequestStatus,
  PlanStatus,
  TaskStatus,
  TaskVerificationStatus,
} from '../dist/src/generated/prisma/client.js';
import permissionCatalog from '../prisma/permission-catalog.json' with { type: 'json' };

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, '../../../');
const fileEnvironment = {};
loadDotEnv({ path: resolve(scriptDirectory, '../.env'), processEnv: fileEnvironment });
loadDotEnv({ path: resolve(repositoryDirectory, '.env'), processEnv: fileEnvironment });

const configuredNodeEnv = process.env.NODE_ENV ?? fileEnvironment.NODE_ENV ?? 'development';
const environmentFile = configuredNodeEnv === 'production'
  ? '.env.prod'
  : configuredNodeEnv === 'test'
    ? '.env.test'
    : '.env.dev';
loadDotEnv({ path: resolve(repositoryDirectory, environmentFile), processEnv: fileEnvironment, override: true });
for (const [key, value] of Object.entries(fileEnvironment)) {
  if ((process.env[key] === undefined || process.env[key] === '') && value !== undefined) {
    process.env[key] = value;
  }
}

const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase();
const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to seed access control');
if (!username) throw new Error('BOOTSTRAP_ADMIN_USERNAME is required to seed access control');
if (!displayName) throw new Error('BOOTSTRAP_ADMIN_DISPLAY_NAME is required to seed access control');
if (!password) throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required to seed access control');
if (password.length < 8) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 8 characters');
if (/set_in_secret_manager|change-me|replace|example/i.test(password)) {
  throw new Error('BOOTSTRAP_ADMIN_PASSWORD is a placeholder; set a real secret before seeding');
}
if (!/^[a-z0-9._-]{3,120}$/.test(username)) {
  throw new Error('BOOTSTRAP_ADMIN_USERNAME must be 3-120 lowercase letters, numbers, dots, underscores, or hyphens');
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const scrypt = promisify(scryptCallback);

async function passwordHash(value) {
  const salt = randomBytes(16);
  const key = await scrypt(value, salt, 64, { N: 32_768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
}

const sampleDataEnabled = ['development', 'test'].includes(
  process.env.NODE_ENV ?? fileEnvironment.NODE_ENV ?? '',
);
const samplePlanId = 'bca1f523-fd92-4a81-83ca-68a7a4be4004';
const sampleCustomerIds = [
  '8a5b2c10-1d67-4f91-a001-000000000001',
  '8a5b2c10-1d67-4f91-a001-000000000002',
  '8a5b2c10-1d67-4f91-a001-000000000003',
];
const sampleTaskIds = [
  '8a5b2c10-1d67-4f91-a002-000000000001',
  '8a5b2c10-1d67-4f91-a002-000000000002',
  '8a5b2c10-1d67-4f91-a002-000000000003',
];
const sampleTaskResultIds = [
  '8a5b2c10-1d67-4f91-a003-000000000001',
  '8a5b2c10-1d67-4f91-a003-000000000002',
];

async function ensureSampleUser(tx, username, displayName, role, branch, createdById) {
  let user = await tx.user.findUnique({ where: { username } });
  if (!user) {
    user = await tx.user.create({
      data: {
        username,
        displayName,
        passwordHash: await passwordHash(randomBytes(32).toString('base64url')),
      },
    });
  }
  if (user.status !== 'ACTIVE') return null;

  const grant = await tx.userRoleGrant.findUnique({
    where: {
      userId_roleId_scopeAnchor: {
        userId: user.id,
        roleId: role.id,
        scopeAnchor: branch.id,
      },
    },
  });
  if (!grant) {
    await tx.userRoleGrant.create({
      data: {
        userId: user.id,
        roleId: role.id,
        branchId: branch.id,
        scopeAnchor: branch.id,
        createdById,
      },
    });
  }
  return user;
}

async function ensureSampleBranch(tx, roles, createdById) {
  const activeBranches = await tx.branch.findMany({
    where: { status: BranchStatus.ACTIVE },
    orderBy: { code: 'asc' },
    take: 2,
  });
  if (activeBranches.length > 0) {
    const primary = activeBranches.find(({ code, name }) =>
      /HCM|Hồ Chí Minh/i.test(`${code} ${name}`),
    ) ?? activeBranches[0];
    return {
      primary,
      secondary: activeBranches.find(({ id }) => id !== primary.id) ?? primary,
    };
  }

  if (await tx.branch.count() > 0) {
    process.stdout.write('Skipped business samples: existing branches are not active.\n');
    return null;
  }

  const managerRole = roles.get('MANAGE');
  if (!managerRole) throw new Error('MANAGE system role is required to seed a demo branch');
  let manager = await tx.user.findUnique({ where: { username: 'demo.branch.manager' } });
  if (!manager) {
    manager = await tx.user.create({
      data: {
        username: 'demo.branch.manager',
        displayName: 'Nguyễn Văn Minh (mẫu)',
        passwordHash: await passwordHash(randomBytes(32).toString('base64url')),
      },
    });
  }
  if (manager.status !== 'ACTIVE') {
    throw new Error('Cannot seed a demo branch because the reserved demo manager is not active');
  }

  const branch = await tx.branch.create({
    data: {
      id: 'bca1f523-fd92-4a81-83ca-68a7a4be4101',
      code: 'DEMO-HCM',
      name: 'Chi nhánh mẫu Hồ Chí Minh',
      managerUserId: manager.id,
      status: BranchStatus.ACTIVE,
    },
  });
  await ensureSampleUser(
    tx,
    'demo.branch.manager',
    'Nguyễn Văn Minh (mẫu)',
    managerRole,
    branch,
    createdById,
  );
  process.stdout.write('Seeded one demo active branch and manager.\n');
  return { primary: branch, secondary: branch };
}

async function seedDevelopmentPlans(tx, createdById) {
  if (!sampleDataEnabled || await tx.plan.count() > 0) return;

  const branches = await tx.branch.findMany({
    where: { status: BranchStatus.ACTIVE },
    orderBy: { code: 'asc' },
    take: 2,
  });
  if (branches.length === 0) {
    process.stdout.write('Skipped demo plans: no active branch is available.\n');
    return;
  }

  const primaryBranch = branches.find(({ code, name }) =>
    /HCM|Hồ Chí Minh/i.test(`${code} ${name}`),
  ) ?? branches[0];
  const secondaryBranch = branches.find(({ id }) => id !== primaryBranch.id) ?? primaryBranch;
  const fixtures = [
    {
      id: 'bca1f523-fd92-4a81-83ca-68a7a4be4004',
      name: 'Tăng trưởng khách hàng & hoàn thiện hồ sơ vay cá nhân — khu vực Đông Nam Bộ quý IV/2026',
      description: 'Theo dõi lượt tư vấn và số hồ sơ hoàn thiện trong quý IV/2026.',
      branch: primaryBranch,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      status: 'ACTIVE',
      metrics: [
        { name: 'Lượt tư vấn', unit: 'lượt', target: 420 },
        { name: 'Hồ sơ hoàn thiện', unit: 'hồ sơ', target: 96 },
      ],
    },
    {
      id: 'bca1f523-fd92-4a81-83ca-68a7a4be4003',
      name: 'Mở rộng tệp khách hàng ưu tiên',
      description: 'Mục tiêu phát triển khách hàng ưu tiên và tiếp nhận hồ sơ vay.',
      branch: secondaryBranch,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      status: 'DRAFT',
      metrics: [
        { name: 'Khách hàng mới', unit: 'khách', target: 0 },
        { name: 'Hồ sơ vay', unit: 'hồ sơ', target: 35 },
      ],
    },
    {
      id: 'bca1f523-fd92-4a81-83ca-68a7a4be4002',
      name: 'Chăm sóc hồ sơ cần bổ sung',
      description: 'Rà soát và hỗ trợ hoàn thiện các hồ sơ còn thiếu thông tin.',
      branch: primaryBranch,
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
      status: 'ARCHIVED',
      metrics: [{ name: 'Hồ sơ xử lý', unit: 'hồ sơ', target: 125 }],
    },
    {
      id: 'bca1f523-fd92-4a81-83ca-68a7a4be4001',
      name: 'Kết nối đối tác và rà soát hồ sơ khu vực miền Tây',
      description: 'Tổng kết mục tiêu giải ngân và phối hợp đối tác trong nửa đầu năm.',
      branch: secondaryBranch,
      periodStart: '2026-01-01',
      periodEnd: '2026-06-30',
      status: 'ARCHIVED',
      metrics: [{ name: 'Giải ngân mục tiêu', unit: '₫', target: 1_284_500_000 }],
    },
  ];

  for (const fixture of fixtures) {
    await tx.plan.create({
      data: {
        id: fixture.id,
        name: fixture.name,
        description: fixture.description,
        createdById,
        periodStart: new Date(`${fixture.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${fixture.periodEnd}T00:00:00.000Z`),
        status: fixture.status,
        branches: { create: [{ branchId: fixture.branch.id }] },
        metrics: { create: fixture.metrics },
      },
    });
  }

  process.stdout.write('Seeded four development/test demo plans.\n');
}

async function seedSampleCustomers(tx, branch, createdById) {
  if (await tx.customer.count() === 0) {
    await tx.customer.createMany({
      data: [
        {
          id: sampleCustomerIds[0],
          fullName: 'Nguyễn Thị Phương Thảo',
          normalizedName: 'nguyen thi phuong thao',
          phone: '0000000001',
          phoneNormalized: '0000000001',
          email: 'phuong.thao@example.com',
          emailNormalized: 'phuong.thao@example.com',
          provenance: 'DEVELOPMENT_TEST_SAMPLE',
          verificationStatus: CustomerVerificationStatus.UNVERIFIED,
          status: CustomerStatus.CONTACTED,
          branchId: branch.id,
          createdById,
        },
        {
          id: sampleCustomerIds[1],
          fullName: 'Nguyễn Phương Thảo',
          normalizedName: 'nguyen phuong thao',
          phone: '0000000002',
          phoneNormalized: '0000000002',
          email: 'nguyen.phuong.thao@example.com',
          emailNormalized: 'nguyen.phuong.thao@example.com',
          provenance: 'DEVELOPMENT_TEST_SAMPLE',
          verificationStatus: CustomerVerificationStatus.UNVERIFIED,
          status: CustomerStatus.QUALIFIED,
          branchId: branch.id,
          createdById,
        },
        {
          id: sampleCustomerIds[2],
          fullName: 'Lê Quang Huy',
          normalizedName: 'le quang huy',
          phone: '0000000003',
          phoneNormalized: '0000000003',
          email: 'quang.huy@example.com',
          emailNormalized: 'quang.huy@example.com',
          provenance: 'DEVELOPMENT_TEST_SAMPLE',
          verificationStatus: CustomerVerificationStatus.UNVERIFIED,
          status: CustomerStatus.NEW,
          branchId: branch.id,
          createdById,
        },
      ],
    });
    process.stdout.write('Seeded three sample customers.\n');
  }
  return tx.customer.findMany({
    where: { id: { in: sampleCustomerIds } },
    orderBy: { id: 'asc' },
  });
}

async function seedCustomerRelations(tx, customers, branch, adviser, createdById) {
  if (customers.length === 0) return;

  if (adviser && await tx.customerAssignment.count() === 0) {
    await tx.customerAssignment.createMany({
      data: customers.map((customer, index) => ({
        id: `8a5b2c10-1d67-4f91-a004-${String(index + 1).padStart(12, '0')}`,
        customerId: customer.id,
        adviserId: adviser.id,
        branchId: branch.id,
        assignedById: createdById,
      })),
    });
    process.stdout.write('Seeded sample customer assignments.\n');
  }

  if (await tx.customerStatusHistory.count() === 0) {
    const history = [
      {
        id: '8a5b2c10-1d67-4f91-a005-000000000001',
        customerId: sampleCustomerIds[0],
        fromStatus: CustomerStatus.NEW,
        toStatus: CustomerStatus.CONTACTED,
      },
      {
        id: '8a5b2c10-1d67-4f91-a005-000000000002',
        customerId: sampleCustomerIds[1],
        fromStatus: CustomerStatus.CONTACTED,
        toStatus: CustomerStatus.QUALIFIED,
      },
    ].filter(({ customerId }) => customers.some((customer) => customer.id === customerId));
    if (history.length > 0) {
      await tx.customerStatusHistory.createMany({
        data: history.map((entry) => ({
          ...entry,
          reason: 'Cập nhật trạng thái trong dữ liệu mẫu dev/test.',
          changedById: createdById,
        })),
      });
      process.stdout.write('Seeded sample customer status history.\n');
    }
  }

  if (customers.length > 1 && await tx.duplicateCandidate.count() === 0) {
    await tx.duplicateCandidate.create({
      data: {
        id: '8a5b2c10-1d67-4f91-a006-000000000001',
        customerId: customers[0].id,
        candidateCustomerId: customers[1].id,
        matchReasons: { normalizedName: true },
        status: DuplicateReviewStatus.OPEN,
      },
    });
    process.stdout.write('Seeded one sample duplicate-review candidate.\n');
  }
}

async function seedLoanRecords(tx, customers, branch, createdById) {
  if (customers.length < 2) return;

  if (await tx.loanRequest.count() === 0) {
    await tx.loanRequest.createMany({
      data: [
        {
          id: '8a5b2c10-1d67-4f91-a007-000000000001',
          customerId: customers[0].id,
          branchId: branch.id,
          source: LoanRequestSource.ADVISING,
          topic: 'Tư vấn hồ sơ vay cá nhân',
          notes: 'Dữ liệu mẫu dev/test; không phải yêu cầu vay thật.',
          status: LoanRequestStatus.OPEN,
          recordedById: createdById,
        },
        {
          id: '8a5b2c10-1d67-4f91-a007-000000000002',
          customerId: customers[1].id,
          branchId: branch.id,
          source: LoanRequestSource.ADVISING,
          topic: 'Kiểm tra điều kiện hồ sơ bổ sung',
          notes: 'Dữ liệu mẫu dev/test; không phải yêu cầu vay thật.',
          status: LoanRequestStatus.CLOSED,
          recordedById: createdById,
        },
      ],
    });
    process.stdout.write('Seeded two sample loan requests.\n');
  }

  if (await tx.loanContract.count() === 0) {
    await tx.loanContract.createMany({
      data: [
        {
          id: '8a5b2c10-1d67-4f91-a008-000000000001',
          customerId: customers[0].id,
          branchId: branch.id,
          contractNumber: 'DEMO-LOAN-2026-001',
          packageCode: 'DEMO-PERSONAL',
          packageName: 'Gói vay cá nhân mẫu',
          packageVersion: '1',
          loanType: 'Vay cá nhân',
          termMonths: 24,
          status: LoanContractStatus.PENDING_REVIEW,
          createdById,
        },
        {
          id: '8a5b2c10-1d67-4f91-a008-000000000002',
          customerId: customers[1].id,
          branchId: branch.id,
          contractNumber: 'DEMO-LOAN-2026-002',
          packageCode: 'DEMO-BUSINESS',
          packageName: 'Gói vay kinh doanh mẫu',
          packageVersion: '1',
          loanType: 'Vay kinh doanh',
          termMonths: 36,
          status: LoanContractStatus.PENDING_REVIEW,
          createdById,
        },
      ],
    });
    process.stdout.write('Seeded two sample loan contracts.\n');
  }

  if (await tx.loanContractStatusHistory.count() === 0) {
    const contracts = await tx.loanContract.findMany({
      where: {
        id: {
          in: [
            '8a5b2c10-1d67-4f91-a008-000000000001',
            '8a5b2c10-1d67-4f91-a008-000000000002',
          ],
        },
      },
    });
    if (contracts.length > 0) {
      await tx.loanContractStatusHistory.createMany({
        data: contracts.map((contract, index) => ({
          id: `8a5b2c10-1d67-4f91-a009-${String(index + 1).padStart(12, '0')}`,
          contractId: contract.id,
          toStatus: LoanContractStatus.PENDING_REVIEW,
          reason: 'Hồ sơ mẫu được tạo để kiểm tra luồng duyệt.',
          changedById: createdById,
        })),
      });
      process.stdout.write('Seeded sample loan-contract status history.\n');
    }
  }
}

async function seedTasks(tx, roles, createdById, branch, adviser) {
  const plan = await tx.plan.findUnique({
    where: { id: samplePlanId },
    include: { branches: true, metrics: true },
  });
  if (!plan || plan.status !== PlanStatus.ACTIVE || plan.metrics.length === 0) {
    process.stdout.write('Skipped sample tasks: the active demo plan is unavailable.\n');
    return;
  }
  const planBranch = plan.branches.find(({ branchId }) => branchId === branch.id) ?? plan.branches[0];
  if (!planBranch) {
    process.stdout.write('Skipped sample tasks: the active demo plan has no branch.\n');
    return;
  }

  const manager = branch.managerUserId
    ? await tx.user.findUnique({ where: { id: branch.managerUserId } })
    : null;
  let submitter = adviser?.status === 'ACTIVE' && adviser.id !== createdById
    ? adviser
    : manager?.status === 'ACTIVE' && manager.id !== createdById
      ? manager
      : null;
  if (!submitter) {
    const adviserRole = roles.get('ADVISING');
    if (!adviserRole) throw new Error('ADVISING system role is required to seed demo tasks');
    submitter = await ensureSampleUser(
      tx,
      'demo.task.adviser',
      'Trần Minh Anh (mẫu)',
      adviserRole,
      branch,
      createdById,
    );
  }
  if (!submitter) {
    process.stdout.write('Skipped sample tasks: no active demo submitter is available.\n');
    return;
  }

  const metric = plan.metrics[0];
  if (await tx.task.count() === 0) {
    await tx.task.createMany({
      data: [
        {
          id: sampleTaskIds[0],
          planId: plan.id,
          metricId: metric.id,
          branchId: planBranch.branchId,
          title: 'Rà soát hồ sơ khách hàng ưu tiên trước hạn chốt quý',
          description: 'Task mẫu có hạn đã qua để kiểm tra trạng thái quá hạn.',
          createdById,
          assigneeId: submitter.id,
          dueAt: new Date('2026-11-10T09:00:00.000Z'),
          status: TaskStatus.TODO,
        },
        {
          id: sampleTaskIds[1],
          planId: plan.id,
          metricId: metric.id,
          branchId: planBranch.branchId,
          title: 'Hoàn thiện danh sách tư vấn tuần này',
          description: 'Kết quả đang chờ xác minh.',
          createdById,
          assigneeId: submitter.id,
          dueAt: new Date('2026-11-18T09:00:00.000Z'),
          status: TaskStatus.IN_PROGRESS,
        },
        {
          id: sampleTaskIds[2],
          planId: plan.id,
          metricId: metric.id,
          branchId: planBranch.branchId,
          title: 'Đối chiếu số lượt tư vấn tháng trước',
          description: 'Task mẫu đã hoàn tất và có kết quả xác minh.',
          createdById,
          assigneeId: submitter.id,
          dueAt: new Date('2026-10-30T09:00:00.000Z'),
          status: TaskStatus.COMPLETED,
        },
      ],
    });
    process.stdout.write('Seeded three sample tasks.\n');
  }

  const tasks = await tx.task.findMany({
    where: { id: { in: sampleTaskIds }, assigneeId: { not: null } },
    select: { id: true, assigneeId: true, status: true, createdAt: true, updatedAt: true },
  });
  if (tasks.length > 0) {
    await tx.taskAssignment.createMany({
      data: tasks.map((task) => ({
        id: task.id,
        taskId: task.id,
        assigneeId: task.assigneeId,
        target: 30,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })),
      skipDuplicates: true,
    });
    await tx.taskAssignment.updateMany({
      where: { taskId: { in: tasks.map(({ id }) => id) }, target: null },
      data: { target: 30 },
    });
  }

  if (await tx.taskResult.count() === 0 && tasks.length > 0) {
    await tx.taskResult.createMany({
      data: tasks.flatMap(({ id }) => {
        const index = sampleTaskIds.indexOf(id);
        if (index !== 1 && index !== 2) return [];
        return [{
          id: sampleTaskResultIds[index - 1],
          taskId: id,
          assignmentId: id,
          revision: 1,
          submittedById: submitter.id,
          reportedValue: index === 1 ? 18 : 24,
          reportedUnit: metric.unit,
          narrative: 'Số liệu giả phục vụ kiểm thử giao diện và luồng xác minh.',
          occurredAt: new Date(index === 1 ? '2026-11-11T09:00:00.000Z' : '2026-10-29T09:00:00.000Z'),
        }];
      }),
    });
    process.stdout.write('Seeded sample task results.\n');
  }

  const removedPendingSampleVerifications = await tx.taskVerification.deleteMany({
    where: {
      resultId: { in: sampleTaskResultIds },
      status: TaskVerificationStatus.PENDING_VERIFICATION,
    },
  });
  if (removedPendingSampleVerifications.count > 0) {
    process.stdout.write('Removed invalid pending verification records from sample results.\n');
  }

  if (await tx.taskVerification.count() === 0) {
    const results = await tx.taskResult.findMany({
      where: { id: sampleTaskResultIds[1] },
      select: { id: true, taskId: true },
    });
    if (results.length > 0) {
      await tx.taskVerification.createMany({
        data: results.map((result) => ({
          resultId: result.id,
          verifierId: createdById,
          status: TaskVerificationStatus.VERIFIED,
        })),
      });
      process.stdout.write('Seeded sample task verifications.\n');
    }
  }
}

async function seedBusinessSamples(tx, roles, createdById) {
  if (!sampleDataEnabled) return;
  const branches = await ensureSampleBranch(tx, roles, createdById);
  if (!branches) return;

  await seedDevelopmentPlans(tx, createdById);
  const manager = branches.primary.managerUserId
    ? await tx.user.findUnique({ where: { id: branches.primary.managerUserId } })
    : null;
  const adviserRole = roles.get('ADVISING');
  if (!adviserRole) throw new Error('ADVISING system role is required to seed business samples');
  const adviser = manager?.status === 'ACTIVE' && manager.id !== createdById
    ? manager
    : await ensureSampleUser(
        tx,
        'demo.customer.adviser',
        'Trần Minh Anh (mẫu)',
        adviserRole,
        branches.primary,
        createdById,
      );

  const customers = await seedSampleCustomers(tx, branches.primary, createdById);
  await seedCustomerRelations(tx, customers, branches.primary, adviser, createdById);
  await seedLoanRecords(tx, customers, branches.primary, createdById);
  await seedTasks(tx, roles, createdById, branches.primary, adviser);
}

try {
  await prisma.$transaction(async (tx) => {
    for (const permission of permissionCatalog) {
      await tx.permission.upsert({ where: { key: permission.key }, create: permission, update: permission });
    }

    const planMetricCatalog = [
      ['new_customers', 'Khách hàng mới', 'khách hàng'],
      ['outreach_attempts', 'Lượt tiếp cận', 'lượt'],
      ['consultations', 'Lượt tư vấn', 'lượt'],
      ['loan_applications_received', 'Hồ sơ tiếp nhận', 'hồ sơ'],
      ['loan_applications_completed', 'Hồ sơ hoàn thiện', 'hồ sơ'],
      ['loan_applications_approved', 'Hồ sơ được duyệt', 'hồ sơ'],
      ['loans_disbursed', 'Khoản giải ngân', 'khoản'],
      ['disbursement_amount', 'Giá trị giải ngân', 'VND'],
    ];
    for (const [key, name, unit] of planMetricCatalog) {
      await tx.planMetricCatalog.upsert({
        where: { key },
        create: { key, name, unit },
        update: {},
      });
    }

    const systemRoles = [
      ['OPERATOR', 'Platform operator'],
      ['ADMIN', 'Administrator'],
      ['MANAGE', 'Branch manager'],
      ['ADVISING', 'Adviser'],
      ['CUSTOMER', 'Customer'],
    ];
    const roles = new Map();
    for (const [key, name] of systemRoles) {
      roles.set(key, await tx.role.upsert({
        where: { key },
        create: { key, name, isSystem: true },
        update: { name, isSystem: true },
      }));
    }

    const branchManagerPermissions = [
      'branches.read', 'users.read', 'users.manage', 'roles.read', 'roles.manage', 'audit.read',
      'customers.read', 'customers.manage', 'customers.assign', 'customers.duplicates.review',
      'loan-requests.read', 'loan-requests.manage', 'loan-contracts.read', 'loan-contracts.manage',
      'loan-contracts.review', 'loan-contracts.status.manage', 'loan-contracts.ingest',
      'plans.read', 'plans.manage', 'plans.approve',
      'tasks.read', 'tasks.manage', 'tasks.submit', 'tasks.verify', 'kpi.read',
    ];
    const advisingPermissions = [
      'customers.read', 'customers.manage', 'loan-requests.read', 'loan-requests.manage', 'loan-contracts.read',
      'plans.read', 'plans.manage', 'tasks.read', 'tasks.submit', 'kpi.read',
    ];
    const defaults = new Map([
      ['OPERATOR', permissionCatalog.map(({ key }) => [key, AccessScope.ALL])],
      ['ADMIN', permissionCatalog.map(({ key }) => [key, AccessScope.ALL])],
      ['MANAGE', branchManagerPermissions.map((key) => [key, AccessScope.BRANCH])],
      ['ADVISING', advisingPermissions.map((key) => [key, AccessScope.ASSIGNED])],
      ['CUSTOMER', []],
    ]);
    for (const [roleKey, permissions] of defaults) {
      const role = roles.get(roleKey);
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissions.length) {
        await tx.rolePermission.createMany({
          data: permissions.map(([permissionKey, scope]) => ({ roleId: role.id, permissionKey, scope })),
        });
      }
    }

    let admin = await tx.user.findUnique({ where: { username } });
    let createdAdmin = false;
    if (!admin) {
      createdAdmin = true;
      admin = await tx.user.create({
        data: {
          username,
          displayName,
          passwordHash: await passwordHash(password),
          mustChangePassword: false,
        },
      });
    }
    const operatorRole = roles.get('OPERATOR');
    const operatorGrant = await tx.userRoleGrant.findUnique({
      where: { userId_roleId_scopeAnchor: { userId: admin.id, roleId: operatorRole.id, scopeAnchor: 'GLOBAL' } },
    });
    if (!operatorGrant && !createdAdmin) {
      throw new Error('Bootstrap username already exists without the initial operator grant; refusing privilege escalation');
    }
    if (!operatorGrant) {
      await tx.userRoleGrant.create({
        data: { userId: admin.id, roleId: operatorRole.id, scopeAnchor: 'GLOBAL' },
      });
      await tx.auditEvent.create({
        data: {
          actorId: admin.id,
          action: 'system.access_control.seeded',
          targetType: 'user',
          targetId: admin.id,
          afterState: { permissionCount: permissionCatalog.length, systemRoleCount: systemRoles.length },
        },
      });
    }

    await seedBusinessSamples(tx, roles, admin.id);
  });
  process.stdout.write('Access control catalog and bootstrap operator are ready.\n');
} finally {
  await prisma.$disconnect();
}
