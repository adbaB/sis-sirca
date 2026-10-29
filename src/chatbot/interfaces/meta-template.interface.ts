export interface MetaTemplateTextParameter {
  type: 'text';
  parameter_name?: string;
  text: string;
}

export interface MetaTemplateActionParameter {
  type: 'action';
  action: {
    flow_token: string;
    flow_action_data?: Record<string, unknown>;
  };
}

export interface MetaTemplatePayloadParameter {
  type: 'payload';
  payload: string;
}

export type MetaTemplateParameter =
  MetaTemplateTextParameter | MetaTemplateActionParameter | MetaTemplatePayloadParameter;

export interface MetaTemplateComponent {
  type: 'body' | 'button' | 'header';
  sub_type?: 'flow' | 'quick_reply' | 'url';
  index?: string;
  parameters: MetaTemplateParameter[];
}

export interface MetaTemplatePayload {
  name: string;
  language: {
    code: string;
  };
  components?: MetaTemplateComponent[];
}

export type MetaTemplateVariables = Record<string, string | number> | Array<string | number>;
