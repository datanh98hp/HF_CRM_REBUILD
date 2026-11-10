import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerListQueryDto } from './customer.dto.js';

describe('CustomerListQueryDto', () => {
  it('accepts take as a numeric query parameter', async () => {
    const query = plainToInstance(CustomerListQueryDto, { take: '100' });

    expect(query.take).toBe(100);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('accepts one extra result for pagination lookahead', async () => {
    const query = plainToInstance(CustomerListQueryDto, { take: '101' });

    expect(query.take).toBe(101);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it('rejects take values above the maximum', async () => {
    const query = plainToInstance(CustomerListQueryDto, { take: '102' });

    expect(await validate(query)).not.toHaveLength(0);
  });
});
