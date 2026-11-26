import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { CreateSupplierCaseDto, ResolveSupplierCaseDto, SendSupplierCaseMessageDto } from './dto/supplier-cases.dto';
import { SupplierCasesService } from './supplier-cases.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('partner-supply/cases')
export class SupplierCasesController {
  constructor(private readonly cases: SupplierCasesService) {}

  @Post()
  @Roles('TECHNICIAN')
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateSupplierCaseDto) {
    return this.cases.create(actor, dto);
  }

  @Get()
  @Roles('TECHNICIAN', 'SELLER', 'SUPER_ADMIN')
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.cases.list(actor);
  }

  @Post(':id/resolve')
  @Roles('SELLER', 'SUPER_ADMIN')
  resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveSupplierCaseDto,
  ) {
    return this.cases.resolve(actor, id, dto);
  }

  @Post(':id/messages')
  @Roles('TECHNICIAN', 'SELLER')
  sendMessage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendSupplierCaseMessageDto,
  ) {
    return this.cases.sendMessage(actor, id, dto);
  }
}
