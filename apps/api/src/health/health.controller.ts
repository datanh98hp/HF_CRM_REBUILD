import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseHealthService } from './database-health.service.js';
import { Public } from '../common/auth-metadata.js';

@Public()
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly databaseHealth: DatabaseHealthService) {}

  @Get('/health')
  @ApiOperation({ summary: 'Process liveness probe' })
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('/ready')
  @ApiOperation({ summary: 'Dependency readiness probe' })
  async ready(): Promise<{ status: 'ready' }> {
    if (!(await this.databaseHealth.isReady())) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Service is not ready',
      });
    }
    return { status: 'ready' };
  }
}
