import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../common/actor-context.js';
import type { ActorContext, ActorRequest } from '../common/actor-context.js';
import { RequirePermission } from '../common/auth-metadata.js';
import { CreatePlanDto, PlanListQueryDto } from './plans.dto.js';
import { PlansService } from './plans.service.js';

@Controller('plans')
@ApiTags('plans and KPI')
@ApiBearerAuth()
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @RequirePermission('plans.read')
  @Get()
  list(@CurrentActor() actor: ActorContext, @Query() query: PlanListQueryDto) {
    return this.plans.list(actor, query);
  }

  @RequirePermission('plans.manage')
  @Post()
  create(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreatePlanDto,
    @Req() request: ActorRequest,
  ) {
    return this.plans.create(actor, dto, request);
  }
}
