export interface FlowEncryptedRequest {
  encrypted_aes_key: string;
  encrypted_flow_data: string;
  initial_vector: string;
}

export interface FlowDecryptedPayload {
  action?: string;
  screen?: string;
  data?: Record<string, unknown>;
}

export interface FlowResponse {
  screen: string;
  data: Record<string, unknown>;
}

export interface FetchInvoicesData {
  doc_type: string;
  doc_number: string;
  action?: string;
}

export interface FetchPaymentData {
  selected_invoices: string[];
  payment_method: string;
  doc_type?: string;
  doc_number?: string;
  action?: string;
}
