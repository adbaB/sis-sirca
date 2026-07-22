import { FlowDecryptedPayload, FlowResponse } from '../interfaces/flow.interface';

export interface FlowActionHandler {
  canHandle(payload: FlowDecryptedPayload): boolean;
  handle(data: Record<string, unknown>): Promise<FlowResponse>;
}
