/* ── Raw shapes devueltas por las queries SQL de estadísticas ─────────── */

export interface VerificationKpiRaw {
  facturas_verificadas: string;
  monto_verificado: string;
  monto_verificado_bs: string;
  facturas_pendientes_verificar: string;
  monto_sin_verificar: string;
  monto_sin_verificar_bs: string;
}

export interface InvoiceSummaryRaw {
  invoices_paid: string;
  total_paid: string;
  invoices_partial: string;
  total_partial: string;
  total_partial_to_paid: string;
  invoices_pending: string;
  total_pending: string;
  grand_total_amount: string;
  total_base_amount: string;
  total_retention: string;
  total_collected: string;
}

export interface AffiliatesSummaryRaw {
  total_affiliates: string | number;
  inclusion_count: string | number;
  inclusion_amount: string | number;
  subscription_count: string | number;
  subscription_amount: string | number;
}

export interface MonthlyTrendRaw {
  month: string;
  verified: string;
  pending: string;
}
