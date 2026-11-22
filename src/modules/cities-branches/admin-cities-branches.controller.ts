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
import { CitiesBranchesService } from './cities-branches.service';
import {
  CreateBranchDto,
  CreateCityDto,
  UpdateBranchDto,
  UpdateCityDto,
} from './dto/cities-branches.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminCitiesBranchesController {
  constructor(private readonly citiesBranchesService: CitiesBranchesService) {}

  // ── Cities: SUPER_ADMIN only (multi-city rollout control) ────────────────

  @Roles(UserRole.SUPER_ADMIN)
  @Get('cities')
  async listCities() {
    return this.citiesBranchesService.listAllCities();
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post('cities')
  async createCity(@Body() dto: CreateCityDto) {
    return this.citiesBranchesService.createCity(dto);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch('cities/:id')
  async updateCity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCityDto) {
    return this.citiesBranchesService.updateCity(id, dto);
  }

  // ── Branches ──────────────────────────────────────────────────────────────

  @Roles(UserRole.SUPER_ADMIN)
  @Post('branches')
  async createBranch(@Body() dto: CreateBranchDto) {
    return this.citiesBranchesService.createBranch(dto);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN)
  @Get('branches')
  async listBranches(@CurrentUser() actor: AuthenticatedUser) {
    return this.citiesBranchesService.listBranches(actor);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN)
  @Patch('branches/:id')
  async updateBranch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.citiesBranchesService.updateBranch(actor, id, dto);
  }
}
