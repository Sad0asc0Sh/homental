import { IsObject } from 'class-validator';

export class UpdatePlatformConfigDto {
  @IsObject()
  value!: Record<string, unknown>;
}
