import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { UsersService } from './users.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
  UpdateMeDto,
} from './dto/users.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Get('me/addresses')
  async listAddresses(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listAddresses(user);
  }

  @Roles(UserRole.CUSTOMER)
  @Post('me/addresses')
  async createAddress(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAddressDto) {
    return this.usersService.createAddress(user, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Patch('me/addresses/:id')
  async updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.usersService.updateAddress(user, id, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Delete('me/addresses/:id')
  async deleteAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.deleteAddress(user, id);
  }
}
