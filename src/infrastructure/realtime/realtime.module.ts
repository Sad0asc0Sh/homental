import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { RedisService } from '@infra/redis/redis.service';
import { RealtimeEvent } from './realtime.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

/**
 * Global realtime module. Subscribes to `notifications:user:*` over Redis
 * Pub/Sub and forwards every message into the matching `user:{userId}` socket
 * room — so instances other than the emitting one also deliver live events
 * (horizontal scaling ready).
 */
@Global()
@Module({
  providers: [RealtimeService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule implements OnModuleInit {
  constructor(
    private readonly redis: RedisService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redis.subscribePattern('notifications:user:*', (channel, message) => {
      const userId = channel.replace('notifications:user:', '');
      this.realtimeService.emitToUser(userId, RealtimeEvent.NOTIFICATION, { raw: message });
    });
  }
}
