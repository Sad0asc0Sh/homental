import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { LocationType, SecurityPillar, ServiceKey, SupplyMode, UrgencyLevel } from '@prisma/client';
import type { ServiceConfigAnswer } from '../advisory.types';
import { SliderSelectionDto } from '../../pricing/dto/slider-selection.dto';

// ── Guest / customer evaluation ──────────────────────────────────────────────

export class EvaluateAdvisoryDto extends SliderSelectionDto {
  @IsIn(Object.values(LocationType))
  locationType!: LocationType;

  @IsOptional()
  @IsObject()
  buildingContext?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  servicesConfig?: Record<string, ServiceConfigAnswer>;

  // ── One-call Sticky Live Bar pricing options (Part B, Task 4) ──────────────

  @IsOptional()
  @IsBoolean()
  includePricing?: boolean;

  @IsOptional()
  @IsString()
  citySlug?: string;

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
  @IsIn(Object.values(UrgencyLevel))
  urgency?: UrgencyLevel;

  @IsOptional()
  @IsIn(Object.values(SupplyMode))
  supplyMode?: SupplyMode;
}

// ── Security profiles (CUSTOMER) ─────────────────────────────────────────────

export class CreateSecurityProfileDto {
  @IsUUID()
  addressId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  titleFa?: string;

  @IsOptional()
  @IsObject()
  buildingContext?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  servicesConfig?: Record<string, ServiceConfigAnswer>;
}

export class UpdateSecurityProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  titleFa?: string;

  @IsOptional()
  @IsObject()
  buildingContext?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  servicesConfig?: Record<string, ServiceConfigAnswer>;
}

// ── Admin advisory rules (SUPER_ADMIN) ───────────────────────────────────────

export class CreateAdvisoryRuleDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,60}$/, {
    message: 'کد قاعده باید با حروف بزرگ انگلیسی و خط زیر باشد (مثل SHOP_CCTV_NO_ALARM).',
  })
  code!: string;

  @IsIn(Object.values(SecurityPillar))
  pillar!: SecurityPillar;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(LocationType))
  appliesToLocationTypes?: LocationType[];

  @IsObject()
  condition!: Record<string, unknown>;

  @IsString()
  @Length(5, 600)
  suggestedActionFa!: string;

  @IsOptional()
  @IsIn(Object.values(ServiceKey))
  suggestedServiceKey?: ServiceKey;

  @IsOptional()
  @IsObject()
  suggestedConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  scoreImpact?: Record<string, unknown>;
}

export class UpdateAdvisoryRuleDto {
  @IsOptional()
  @IsIn(Object.values(SecurityPillar))
  pillar?: SecurityPillar;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(LocationType))
  appliesToLocationTypes?: LocationType[];

  @IsOptional()
  @IsObject()
  condition?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(5, 600)
  suggestedActionFa?: string;

  @IsOptional()
  @IsIn(Object.values(ServiceKey))
  suggestedServiceKey?: ServiceKey;

  @IsOptional()
  @IsObject()
  suggestedConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  scoreImpact?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
