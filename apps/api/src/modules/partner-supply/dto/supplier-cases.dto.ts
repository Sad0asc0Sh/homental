import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { SupplierCaseType } from '@prisma/client';

const caseDecisions = ['IN_REVIEW', 'APPROVED', 'INSPECTED_ACCEPTED', 'REJECTED', 'RESOLVED', 'CANCELLED'] as const;

export class CreateSupplierCaseDto {
  @IsIn(Object.values(SupplierCaseType))
  type!: SupplierCaseType;

  @IsUUID()
  sellerId!: string;

  @IsString()
  @Length(1, 2000)
  @Matches(/\S/)
  reasonFa!: string;

  @IsOptional()
  @IsUUID()
  fulfillmentId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  lineKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  requestedQty?: number;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  sku?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  serialNumber?: string;
}

export class ResolveSupplierCaseDto {
  @IsIn(caseDecisions)
  status!: (typeof caseDecisions)[number];

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/)
  inspectionNoteFa?: string;

  @IsOptional()
  @IsBoolean()
  sealIntact?: boolean;

  @IsOptional()
  @IsBoolean()
  cutCable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  approvedQty?: number;

  @IsOptional()
  @IsUUID()
  replacementOfferId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  idempotencyKey?: string;
}

export class SendSupplierCaseMessageDto {
  @IsString()
  @Length(1, 2000)
  @Matches(/\S/)
  textFa!: string;
}
