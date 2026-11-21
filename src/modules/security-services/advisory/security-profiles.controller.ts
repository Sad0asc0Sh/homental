import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { AdvisoryService } from './advisory.service';
import {
  CreateSecurityProfileDto,
  UpdateSecurityProfileDto,
} from './dto/advisory.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
@Controller('security-profiles')
export class SecurityProfilesController {
  constructor(private readonly advisoryService: AdvisoryService) {}

  @Post()
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateSecurityProfileDto) {
    return this.advisoryService.createProfile(actor, dto);
  }

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return this.advisoryService.listProfiles(actor);
  }

  @Get(':id')
  async get(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.advisoryService.getProfile(actor, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSecurityProfileDto,
  ) {
    return this.advisoryService.updateProfile(actor, id, dto);
  }
}
