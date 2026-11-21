import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { LocationType, ServiceKey, TechnicianStatus } from '@prisma/client';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  avatarUrl?: string;
}

export class CreateAddressDto {
  @IsUUID()
  cityId!: string;

  @IsString()
  @Length(1, 80)
  titleFa!: string;

  @IsIn(Object.values(LocationType))
  locationType!: LocationType;

  @IsString()
  @Length(5, 500)
  fullAddressFa!: string;

  @IsOptional()
  @IsString()
  @Length(4, 16)
  postalCode?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  titleFa?: string;

  @IsOptional()
  @IsIn(Object.values(LocationType))
  locationType?: LocationType;

  @IsOptional()
  @IsString()
  @Length(5, 500)
  fullAddressFa?: string;

  @IsOptional()
  @IsString()
  @Length(4, 16)
  postalCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateTechnicianDto {
  @IsString()
  @Length(8, 20)
  phone!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  lastName?: string;

  @IsUUID()
  branchId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(Object.values(ServiceKey))
  skills!: ServiceKey[];
}

export class UpdateTechnicianDto {
  @IsOptional()
  @IsIn(Object.values(TechnicianStatus))
  status?: TechnicianStatus;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(Object.values(ServiceKey))
  skills?: ServiceKey[];
}

export class ListTechniciansDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(Object.values(TechnicianStatus))
  status?: TechnicianStatus;

  @IsOptional()
  @IsIn(Object.values(ServiceKey))
  skill?: ServiceKey;
}
