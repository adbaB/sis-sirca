import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { Steps } from '../enums/steps.enum';

export interface UserState {
  step: Steps;
  name?: string;
  email?: string;
  selected_invoices?: string[];
  selected_invoices_details?: Array<{ id: string; amount: number }>;
  pending_invoices?: Array<{ id: string; title: string; description: string; amount: number }>;
  payment_method?: string;
  total_amount?: string;
  extracted_data?: Record<string, unknown>;
  full_name?: string;
  identity_card?: string;
  type_identity_card?: TypeIdentityCard;
  flow_message_id?: string;
}
