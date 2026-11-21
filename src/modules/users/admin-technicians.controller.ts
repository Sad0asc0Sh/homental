import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { AdminTechniciansService } from './admin-technicians.service';
import {
  CreateTechnicianDto,
  ListTechniciansDto,
  UpdateTechnicianDto,
} from './dto/users.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN)
@Controller('admin/technicians')
export class AdminTechniciansController {
  constructor(private readonly adminTechniciansService: AdminTechniciansService) {}

  @Post()
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateTechnicianDto) {
    return this.adminTechniciansService.create(actor, dto);
  }

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListTechniciansDto) {
    return this.adminTechniciansService.list(actor, query);
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTechnicianDto,
  ) {
    return this.adminTechniciansService.update(actor, id, dto);
  }
}
