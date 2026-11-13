import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PlanApprovalDecision, PlanStatus } from '../generated/prisma/client.js';

export enum KpiPeriodType {
  PLAN = 'PLAN',
  MONTH = 'MONTH',
  QUARTER = 'QUARTER',
  YEAR = 'YEAR',
}

export class PlanMetricDto {
  @IsUUID()
  catalogId!: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9999999999999)
  target!: number;
}

export class CreatePlanMetricCatalogDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,79}$/)
  key!: string;

  @IsString()
  @Length(2, 160)
  name!: string;

  @IsString()
  @Length(1, 40)
  unit!: string;
}

export class UpdatePlanMetricCatalogDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReviewPlanDto {
  @IsEnum(PlanApprovalDecision)
  decision!: PlanApprovalDecision;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string;
}

export class CreatePlanDto {
  @IsString()
  @Length(2, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  branchIds!: string[];

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PlanMetricDto)
  metrics!: PlanMetricDto[];
}

export class UpdatePlanDto {
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  addBranchIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  removeBranchIds?: string[];
}

export class PlanListQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  take = 50;
}
