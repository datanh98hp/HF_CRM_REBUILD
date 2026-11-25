import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export enum ReportPeriod {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  QUARTER = 'quarter',
  YEAR = 'year',
}

export enum ReportType {
  CUSTOMERS = 'customers',
  PLANS = 'plans',
  SUMMARY = 'summary',
  LOANS = 'loans',
}

export class ReportQueryDto {
  @IsOptional()
  @IsEnum(ReportPeriod)
  period: ReportPeriod = ReportPeriod.MONTH;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-120)
  @Max(120)
  offset = 0;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsUUID('4')
  adviserId?: string;
}
