import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { TaskVerificationStatus } from '../generated/prisma/client.js';

export class CreateTaskDto {
  @IsUUID()
  metricId!: string;

  @IsUUID()
  branchId!: string;

  @IsString()
  @Length(2, 160)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class SubmitTaskResultDto {
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9999999999999)
  reportedValue!: number;

  @IsString()
  @Length(1, 40)
  reportedUnit!: string;

  @IsString()
  @Length(1, 4000)
  narrative!: string;

  @IsDateString()
  occurredAt!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  evidenceFileIds?: string[];
}

export class VerifyTaskResultDto {
  @IsEnum(TaskVerificationStatus)
  status!: TaskVerificationStatus;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string;
}
