import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../common/actor-context.js';
import type { ActorContext } from '../common/actor-context.js';
import { RequirePermission } from '../common/auth-metadata.js';
import { CUSTOMER_IMPORT_MAX_BYTES } from './customer-import-parser.js';
import type { CustomerImportUpload } from './customer-imports.service.js';
import { CreateCustomerImportBatchDto } from './customer-import.dto.js';
import { CustomerImportsService } from './customer-imports.service.js';

@Controller('customers/import-batches')
@ApiTags('customer imports')
@ApiBearerAuth()
export class CustomerImportsController {
  constructor(private readonly imports: CustomerImportsService) {}

  @RequirePermission('customers.import')
  @Get('readiness')
  readiness() {
    return this.imports.getReadiness();
  }

  @RequirePermission('customers.import')
  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: CUSTOMER_IMPORT_MAX_BYTES, files: 1 },
  }))
  createBatch(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreateCustomerImportBatchDto,
    @UploadedFile() file: CustomerImportUpload | undefined,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.imports.createBatch(actor, dto, file, idempotencyKey);
  }

  @RequirePermission('customers.import')
  @Get()
  history(@CurrentActor() actor: ActorContext) {
    return this.imports.getHistory(actor);
  }

  @RequirePermission('customers.import')
  @Get(':batchId')
  getBatch(
    @CurrentActor() actor: ActorContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ) {
    return this.imports.getBatch(actor, batchId);
  }
}
