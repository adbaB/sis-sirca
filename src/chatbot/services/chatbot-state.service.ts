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

  /**
   * Normalizes phone numbers to a consistent format without '+' prefix.
   * Meta webhooks send phones without '+' (e.g. '584126430136'),
   * but the DB stores them with '+' (e.g. '+584126430136').
   */
  private normalizePhone(phone: string): string {
    return phone.startsWith('+') ? phone.slice(1) : phone;
  }

  async getState(phone: string): Promise<UserState | null> {
    const normalized = this.normalizePhone(phone);
    const data = await this.redis.get(`chatbot_state:${normalized}`);
    return data ? JSON.parse(data) : null;
  }

  async setState(phone: string, state: UserState): Promise<void> {
    const normalized = this.normalizePhone(phone);
    await this.redis.set(
      `chatbot_state:${normalized}`,
      JSON.stringify(state),
      'EX',
      this.STATE_TTL_SECONDS,
    );
    if (state.step !== Steps.AWAITING_NAME) {
      // Ignoramos el saludo inicial si quieres
      await this.analyticsService.trackStep(normalized, state.step, state);
    }
  }

  async clearState(phone: string): Promise<void> {
    const normalized = this.normalizePhone(phone);
    await this.redis.del(`chatbot_state:${normalized}`);
  }
}
