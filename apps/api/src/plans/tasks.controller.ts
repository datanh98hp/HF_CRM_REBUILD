import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../common/actor-context.js';
import type { ActorContext, ActorRequest } from '../common/actor-context.js';
import { RequirePermission } from '../common/auth-metadata.js';
import { CreateTaskDto, SubmitTaskResultDto, VerifyTaskResultDto } from './tasks.dto.js';
import { TasksService } from './tasks.service.js';

@Controller()
@ApiTags('plans, tasks and KPI')
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @RequirePermission('tasks.read')
  @Get('plans/:planId/tasks')
  list(
    @CurrentActor() actor: ActorContext,
    @Param('planId', new ParseUUIDPipe()) planId: string,
  ) {
    return this.tasks.list(actor, planId);
  }

  @RequirePermission('tasks.manage')
  @Post('plans/:planId/tasks')
  create(
    @CurrentActor() actor: ActorContext,
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() dto: CreateTaskDto,
    @Req() request: ActorRequest,
  ) {
    return this.tasks.create(actor, planId, dto, request);
  }

  @RequirePermission('tasks.submit')
  @Post('tasks/:taskId/results')
  submitResult(
    @CurrentActor() actor: ActorContext,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: SubmitTaskResultDto,
    @Req() request: ActorRequest,
  ) {
    return this.tasks.submitResult(actor, taskId, dto, request);
  }

  @RequirePermission('tasks.verify')
  @Post('task-results/:resultId/verifications')
  verifyResult(
    @CurrentActor() actor: ActorContext,
    @Param('resultId', new ParseUUIDPipe()) resultId: string,
    @Body() dto: VerifyTaskResultDto,
    @Req() request: ActorRequest,
  ) {
    return this.tasks.verifyResult(actor, resultId, dto, request);
  }

  @RequirePermission('kpi.read')
  @Get('plans/:planId/kpi')
  kpi(
    @CurrentActor() actor: ActorContext,
    @Param('planId', new ParseUUIDPipe()) planId: string,
  ) {
    return this.tasks.kpi(actor, planId);
  }
}
