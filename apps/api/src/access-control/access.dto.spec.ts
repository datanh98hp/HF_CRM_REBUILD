import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccessScope } from '../generated/prisma/client.js';
import permissionCatalog from '../../prisma/permission-catalog.json' with { type: 'json' };
import { SetRolePermissionsDto } from './access.dto.js';

describe('SetRolePermissionsDto', () => {
  it('accepts every catalog permission at every supported scope', async () => {
    const permissions = permissionCatalog.flatMap(({ key }) =>
      Object.values(AccessScope).map((scope) => ({ permissionKey: key, scope })),
    );
    const dto = plainToInstance(SetRolePermissionsDto, { permissions });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});
