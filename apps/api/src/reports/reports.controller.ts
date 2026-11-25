import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../common/actor-context.js';
import type { ActorContext } from '../common/actor-context.js';
import { RequirePermission } from '../common/auth-metadata.js';
import { ReportsService } from './reports.service.js';
import { ReportQueryDto, ReportType } from './reports.dto.js';

@Controller('reports')
@ApiTags('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermission('reports.read')
  @Get(':reportType')
  @ApiParam({ name: 'reportType', enum: ReportType })
  getReport(
    @CurrentActor() actor: ActorContext,
    @Param('reportType') reportType: string,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.getReport(actor, reportType, query);
  }
}
