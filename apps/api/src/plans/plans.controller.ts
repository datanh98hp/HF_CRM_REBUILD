import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../common/actor-context.js';
import type { ActorContext, ActorRequest } from '../common/actor-context.js';
import { RequirePermission } from '../common/auth-metadata.js';
import {
  CreatePlanDto,
  CreatePlanMetricCatalogDto,
  PlanListQueryDto,
  ReviewPlanDto,
  UpdatePlanDto,
  UpdatePlanMetricCatalogDto,
} from './plans.dto.js';
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

  @RequirePermission('plans.read')
  @Get('metric-catalog')
  listMetricCatalog(@CurrentActor() actor: ActorContext) {
    return this.plans.listMetricCatalog(actor);
  }

  @RequirePermission('plans.catalog.manage')
  @Post('metric-catalog')
  createMetricCatalogItem(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreatePlanMetricCatalogDto,
    @Req() request: ActorRequest,
  ) {
    return this.plans.createMetricCatalogItem(actor, dto, request);
  }

  @RequirePermission('plans.catalog.manage')
  @Patch('metric-catalog/:catalogId')
  updateMetricCatalogItem(
    @CurrentActor() actor: ActorContext,
    @Param('catalogId', new ParseUUIDPipe()) catalogId: string,
    @Body() dto: UpdatePlanMetricCatalogDto,
    @Req() request: ActorRequest,
  ) {
    return this.plans.updateMetricCatalogItem(actor, catalogId, dto, request);
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

  @RequirePermission('plans.manage')
  @Patch(':planId')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() dto: UpdatePlanDto,
    @Req() request: ActorRequest,
  ) {
    return this.plans.update(actor, planId, dto, request);
  }

  @RequirePermission('plans.manage')
  @Post(':planId/submissions')
  submitForApproval(
    @CurrentActor() actor: ActorContext,
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Req() request: ActorRequest,
  ) {
    return this.plans.submitForApproval(actor, planId, request);
  }

  @RequirePermission('plans.approve')
  @Post(':planId/approvals')
  reviewApproval(
    @CurrentActor() actor: ActorContext,
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() dto: ReviewPlanDto,
    @Req() request: ActorRequest,
  ) {
    return this.plans.reviewApproval(actor, planId, dto, request);
  }

  @RequirePermission('plans.read')
  @Delete(':planId')
  softDelete(
    @CurrentActor() actor: ActorContext,
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Req() request: ActorRequest,
  ) {
    return this.plans.softDelete(actor, planId, request);
  }
}
