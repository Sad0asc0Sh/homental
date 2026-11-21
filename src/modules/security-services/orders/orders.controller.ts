import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { OrdersService } from './orders.service';
import {
  AssignTechnicianDto,
  CancelOrderDto,
  CreateOrderDto,
  ListOrdersDto,
  QuoteOrderDto,
} from './dto/orders.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Roles(UserRole.CUSTOMER)
  @Post()
  async create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(actor, dto);
  }

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListOrdersDto) {
    return this.ordersService.list(actor, query);
  }

  @Get(':id')
  async getOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getOne(actor, id);
  }

  @Roles(UserRole.CUSTOMER)
  @Post(':id/submit')
  async submit(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.submit(actor, id);
  }

  @Roles(UserRole.BRANCH_ADMIN, UserRole.SUPER_ADMIN)
  @Post(':id/branch-queue')
  async branchQueue(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.branchQueue(actor, id);
  }

  @Roles(UserRole.BRANCH_ADMIN, UserRole.SUPER_ADMIN)
  @Post(':id/assign-technician')
  async assignTechnician(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTechnicianDto,
  ) {
    return this.ordersService.assignTechnician(actor, id, dto);
  }

  @Roles(UserRole.TECHNICIAN)
  @Post(':id/en-route')
  async enRoute(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.enRoute(actor, id);
  }

  @Roles(UserRole.TECHNICIAN)
  @Post(':id/start-inspection')
  async startInspection(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.startInspection(actor, id);
  }

  @Roles(UserRole.TECHNICIAN)
  @Post(':id/quote')
  async quote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuoteOrderDto,
  ) {
    return this.ordersService.quote(actor, id, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Post(':id/approve-quote')
  async approveQuote(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.approveQuote(actor, id);
  }

  @Roles(UserRole.TECHNICIAN)
  @Post(':id/start-work')
  async startWork(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.startWork(actor, id);
  }

  @Roles(UserRole.CUSTOMER, UserRole.BRANCH_ADMIN, UserRole.SUPER_ADMIN)
  @Post(':id/cancel')
  async cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.ordersService.cancel(actor, id, dto);
  }
}
