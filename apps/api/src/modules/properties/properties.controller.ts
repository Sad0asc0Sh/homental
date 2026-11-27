import {
  Body,
  Controller,
  Delete,
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
import {
  CompletePropertyMediaDto,
  CreatePropertyDto,
  PresignPropertyMediaDto,
  UpdatePropertyDto,
} from './dto/properties.dto';
import { PropertiesService } from './properties.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Roles(UserRole.CUSTOMER)
  @Post()
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreatePropertyDto) {
    return this.propertiesService.create(actor, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return this.propertiesService.list(actor);
  }

  @Roles(
    UserRole.CUSTOMER,
    UserRole.TECHNICIAN,
    UserRole.BRANCH_ADMIN,
    UserRole.SUPER_ADMIN,
  )
  @Get(':id')
  async getOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.propertiesService.getOne(actor, id);
  }

  @Roles(UserRole.CUSTOMER)
  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.propertiesService.update(actor, id, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Delete(':id')
  async archive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.propertiesService.archive(actor, id);
  }

  @Roles(UserRole.CUSTOMER)
  @Post(':id/media/presign')
  async presignMedia(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignPropertyMediaDto,
  ) {
    return this.propertiesService.presignMedia(actor, id, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Post(':id/media/:assetId/complete')
  async completeMedia(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: CompletePropertyMediaDto,
  ) {
    return this.propertiesService.completeMedia(actor, id, assetId, dto);
  }
}
