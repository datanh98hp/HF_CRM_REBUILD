import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { DatabaseHealthService } from './database-health.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;
  let databaseHealth: { isReady: jest.Mock<() => Promise<boolean>> };

  beforeEach(async () => {
    databaseHealth = { isReady: jest.fn<() => Promise<boolean>>() };
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseHealthService, useValue: databaseHealth }],
    }).compile();
    controller = module.get(HealthController);
  });

  it('reports liveness without exposing dependency details', () => {
    expect(controller.health()).toEqual({ status: 'ok' });
  });

  it('reports readiness when PostgreSQL and Redis are reachable', async () => {
    databaseHealth.isReady.mockResolvedValue(true);
    await expect(controller.ready()).resolves.toEqual({ status: 'ready' });
  });

  it('returns a safe unavailable response when a dependency is not ready', async () => {
    databaseHealth.isReady.mockResolvedValue(false);
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
