import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Notification,
  NotificationChannel,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisService } from '@infra/redis/redis.service';
import type { SmsProvider } from './sms-provider.interface';
import { SMS_PROVIDER } from './sms-provider.interface';

export interface SendNotificationInput {
  userId: string;
  type: NotificationType;
  titleFa: string;
  bodyFa: string;
  channel?: NotificationChannel;
  data?: Record<string, unknown>;
}

export interface InboxResult {
  items: Notification[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Persists the notification, dispatches SMS when requested and publishes a
   * BigInt-safe realtime event on `notifications:user:{userId}` — the channel
   * the Task 6 Socket.io bridge subscribes to (Invariant 13).
   */
  async send(input: SendNotificationInput): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        channel: input.channel ?? 'IN_APP',
        titleFa: input.titleFa,
        bodyFa: input.bodyFa,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
        sentAt: new Date(),
      },
    });

    if (notification.channel === 'SMS') {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { phone: true },
      });
      if (user) {
        await this.smsProvider.sendSms({
          phone: user.phone,
          message: `${input.titleFa}\n${input.bodyFa}`,
        });
      }
    }

    await this.redis.publish(`notifications:user:${input.userId}`, {
      id: notification.id,
      type: notification.type,
      titleFa: notification.titleFa,
      bodyFa: notification.bodyFa,
      data: input.data ?? null,
      createdAt: notification.createdAt.toISOString(),
    });

    return notification;
  }

  async listInbox(userId: string, page = 1, limit = 20): Promise<InboxResult> {
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, total, unreadCount, page, limit };
  }

  async markRead(userId: string, notificationId: string): Promise<{ read: true }> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException({ statusCode: 404, message: 'اعلان یافت نشد.' });
    }
    return { read: true };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
