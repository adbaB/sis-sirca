export interface WebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: Array<MetaStatus>;
        messages?: Array<MetaMessage>;
      };
    }>;
  }>;
}

export interface MetaMessage {
  from: string;
  type?: string;
  errors?: Array<{
    code: number;
    title: string;
    message?: string;
    error_data?: Record<string, unknown>;
  }>;
  text?: { body: string };
  image?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string };
  interactive?: {
    type: string;
    nfm_reply?: {
      response_json: string;
      body: string;
      name: string;
    };
    button_reply?: {
      id: string;
      title: string;
    };
  };
}

export interface MetaStatus {
  status: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
  }>;
}
