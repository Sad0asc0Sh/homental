import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { WarrantyClaimStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class RegisterHardwareUnitDto {
  @IsString()
  @Length(1, 80)
  orderItemId!: string;

  @IsString()
  @Length(1, 80)
  categoryFa!: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  brand?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  model?: string;

  @IsString()
  @Length(4, 80)
  serialNumber!: string;
}

export class RegisterHardwareUnitsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterHardwareUnitDto)
  units!: RegisterHardwareUnitDto[];
}

export class RequestHandoverDto {
  @IsBoolean()
  defaultPasswordsChanged!: boolean;

  @IsBoolean()
  technicianAccessRevoked!: boolean;
}

export class CompleteHandoverDto {
  @IsString()
  @Length(6, 6)
  otp!: string;
}

export class CreateWarrantyClaimDto {
  @IsString()
  @Length(5, 1000)
  descriptionFa!: string;

  @IsOptional()
  @IsObject()
  photos?: Record<string, unknown>;
}

export class UpdateWarrantyClaimDto {
  @IsIn(Object.values(WarrantyClaimStatus))
  status!: WarrantyClaimStatus;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  resolutionNoteFa?: string;
}

export class ReviewOrderDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @Length(0, 600)
  commentFa?: string;
}
