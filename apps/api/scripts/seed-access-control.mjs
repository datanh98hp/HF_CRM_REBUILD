import { config as loadDotEnv } from 'dotenv';
import { scrypt as scryptCallback, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, AccessScope } from '../dist/src/generated/prisma/client.js';
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

try {
  await prisma.$transaction(async (tx) => {
    for (const permission of permissionCatalog) {
      await tx.permission.upsert({ where: { key: permission.key }, create: permission, update: permission });
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

    const operatorPermissionKeys = new Set([
      'auth.me', 'branches.read', 'branches.manage', 'users.read', 'users.manage',
      'roles.read', 'roles.manage', 'permissions.read', 'permissions.delegate', 'audit.read',
    ]);
    const operatorRole = roles.get('OPERATOR');
    for (const permissionKey of operatorPermissionKeys) {
      await tx.rolePermission.upsert({
        where: { roleId_permissionKey_scope: { roleId: operatorRole.id, permissionKey, scope: AccessScope.ALL } },
        create: { roleId: operatorRole.id, permissionKey, scope: AccessScope.ALL },
        update: {},
      });
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
  });
  process.stdout.write('Access control catalog and bootstrap operator are ready.\n');
} finally {
  await prisma.$disconnect();
}
