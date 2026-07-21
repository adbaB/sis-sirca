export interface MetaTemplateTextParameter {
  type: 'text';
  parameter_name: string;
  text: string;
}

export interface MetaTemplateActionParameter {
  type: 'action';
  action: {
    flow_token: string;
    flow_action_data?: Record<string, unknown>;
  };
}

export type MetaTemplateParameter = MetaTemplateTextParameter | MetaTemplateActionParameter;

export interface MetaTemplateComponent {
  type: 'body' | 'button';
  sub_type?: 'flow';
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

export type MetaTemplateVariables = Record<string, string | number>;
