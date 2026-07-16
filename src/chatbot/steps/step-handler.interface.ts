import { Steps } from '../enums/steps.enum';
import { UserState } from '../interfaces/userState.interface';
import { MetaMessage } from '../interfaces/webhook.interface';

export interface IStepHandler {
  canHandle(step: Steps): boolean;
  execute(phone: string, message: MetaMessage, state: UserState): Promise<void>;
}
