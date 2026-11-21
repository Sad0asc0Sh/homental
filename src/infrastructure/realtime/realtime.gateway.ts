import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RealtimeService } from './realtime.service';
import type { Server, Socket } from 'socket.io';

interface SocketUser {
  id: string;
  role: UserRole;
}

/**
 * Live dispatch namespace — `WS /dispatch`.
 * Handshake auth: JWT via `socket.handshake.auth.token` or the
 * `authorization: Bearer …` header; unauthorized sockets are disconnected
 * immediately. Every authenticated socket auto-joins `user:{userId}`;
 * `join_order` verifies visibility before joining `order:{orderId}`.
 */
@WebSocketGateway({
  namespace: '/dispatch',
  cors: { origin: true, credentials: true }, // Next.js frontend (localhost:3001) must handshake cleanly
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server | undefined;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  afterInit(): void {
    if (this.server) {
      this.realtimeService.registerServer(this.server);
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    const user = await this.authenticate(client);
    if (!user) {
      client.disconnect(true);
      return;
    }
    client.data['user'] = user;
    await client.join(`user:${user.id}`);
  }

  handleDisconnect(_client: Socket): void {
    // Rooms are cleaned up automatically by socket.io.
  }

  @SubscribeMessage('join_order')
  async handleJoinOrder(
    client: Socket,
    payload: { orderId?: string },
  ): Promise<{ event: string; data: { joined: boolean; orderId?: string } }> {
    const user = client.data['user'] as SocketUser | undefined;
    const orderId = payload?.orderId;
    if (!user || !orderId) {
      return { event: 'join_order', data: { joined: false } };
    }
    const allowed = await this.canJoinOrder(user, orderId);
    if (!allowed) {
      return { event: 'join_order', data: { joined: false, orderId } };
    }
    await client.join(`order:${orderId}`);
    return { event: 'join_order', data: { joined: true, orderId } };
  }

  private async authenticate(client: Socket): Promise<SocketUser | null> {
    const handshake = client.handshake as unknown as {
      auth?: Record<string, unknown>;
      headers?: Record<string, unknown>;
    };
    const rawToken =
      (typeof handshake.auth?.['token'] === 'string' ? handshake.auth['token'] : undefined) ??
      (typeof handshake.headers?.['authorization'] === 'string'
        ? (handshake.headers['authorization'] as string)
        : undefined);
    const token = typeof rawToken === 'string' && rawToken.startsWith('Bearer ')
      ? rawToken.slice('Bearer '.length).trim()
      : rawToken;
    if (typeof token !== 'string' || token.length === 0) return null;

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status !== 'ACTIVE') return null;
      return { id: user.id, role: user.role };
    } catch {
      return null;
    }
  }

  private async canJoinOrder(user: SocketUser, orderId: string): Promise<boolean> {
    const order = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order) return false;
    if (user.role === UserRole.SUPER_ADMIN) return true;
    if (user.role === UserRole.CUSTOMER) return order.customerId === user.id;
    if (user.role === UserRole.TECHNICIAN) return order.technicianId === user.id;
    if (user.role === UserRole.BRANCH_ADMIN) {
      if (order.branchId === null) return false;
      const branch = await this.prisma.branch.findFirst({
        where: { id: order.branchId, adminId: user.id },
        select: { id: true },
      });
      return branch !== null;
    }
    return false;
  }
}
