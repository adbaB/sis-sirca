import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis/built/Redis';
import { UserState } from '../interfaces/userState.interface';
import { Steps } from '../enums/steps.enum';
import { ChatbotAnalyticsService } from './chatbot-analytics.service';

@Injectable()
export class ChatbotStateService {
  private readonly STATE_TTL_SECONDS = 60 * 60 * 24; // 1 day

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly analyticsService: ChatbotAnalyticsService,
  ) {}

  async getState(phone: string): Promise<UserState | null> {
    const data = await this.redis.get(`chatbot_state:${phone}`);
    return data ? JSON.parse(data) : null;
  }

  async setState(phone: string, state: UserState): Promise<void> {
    await this.redis.set(
      `chatbot_state:${phone}`,
      JSON.stringify(state),
      'EX',
      this.STATE_TTL_SECONDS,
    );
    if (state.step !== Steps.AWAITING_NAME) {
      // Ignoramos el saludo inicial si quieres
      await this.analyticsService.trackStep(phone, state.step, state);
    }
  }

  async clearState(phone: string): Promise<void> {
    await this.redis.del(`chatbot_state:${phone}`);
  }
}
