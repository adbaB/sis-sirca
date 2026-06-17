import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PaymentBreakdown,
  StatisticsResponse,
  StatisticsSummary,
} from '../interfaces/response.interface';

/* ── Raw shapes devueltas por las queries SQL ─────────────────────────── */

interface VerificationKpiRaw {
  facturas_verificadas: string;
  monto_verificado: string;
  monto_verificado_bs: string;
  facturas_pendientes_verificar: string;
  monto_sin_verificar: string;
  monto_sin_verificar_bs: string;
}

interface InvoiceSummaryRaw {
  invoices_paid: string;
  total_paid: string;
  invoices_partial: string;
  total_partial: string;
  total_partial_to_paid: string;
  invoices_pending: string;
  total_pending: string;
  /** SUM(total_amount) for all invoices — the grand billing total */
  grand_total_amount: string;
  /** SUM(paid_amount) for PAID + PARTIAL invoices — everything collected so far */
  total_collected: string;
}

interface MonthlyTrendRaw {
  month: string;
  verified: string;
  pending: string;
}

/* ────────────────────────────────────────────────────────────────────── */

@Injectable()
export class StatisticsService {
  constructor(private readonly datasource: DataSource) {}

  /**
   * GET /statistics?year=2026&month=5&advisorUuid=<uuid>
   *
   * Ejecuta las tres consultas en paralelo y mapea los resultados
   * a las interfaces del dashboard.
   *
   * @param advisorUuid – opcional; si se omite, incluye todos los asesores.
   */
  async getStatistics(billingMonth: string, advisorUuid?: string): Promise<StatisticsResponse> {
    const [kpiRaw, summaryRaw] = await Promise.all([
      this.queryVerificationKpi(billingMonth, advisorUuid),
      this.queryInvoiceSummary(billingMonth, advisorUuid),
    ]);

    const summary = this.buildSummary(kpiRaw, summaryRaw);
    const breakdown = this.buildBreakdown(kpiRaw, summaryRaw);

    return { summary, breakdown };
  }

  /* ──────────────────────────────────────────────────────────────────────
     Query 1 — KPI de verificación para el mes de facturación indicado.
     Incluye amount_bs de payments para calcular el monto en bolívares.
     ────────────────────────────────────────────────────────────────────── */
  private async queryVerificationKpi(
    billingMonth: string,
    advisorUuid?: string,
  ): Promise<VerificationKpiRaw> {
    const params: unknown[] = [billingMonth];
    const advisorFilter = advisorUuid ? `AND c.advisor_id = $${params.push(advisorUuid)}` : '';

    const sql = `
      WITH EstadoFacturas AS (
        SELECT
          i.id                                                          AS invoice_id,
          i.paid_amount,
          SUM(p.amount_bs)                                             AS paid_amount_bs,
          SUM(CASE WHEN p.status = 'PROCESSING' THEN 1 ELSE 0 END)    AS processing_qty,
          SUM(CASE WHEN p.status = 'COMPLETED'  THEN 1 ELSE 0 END)    AS completed_qty
        FROM contracts c
        INNER JOIN invoices i ON i.contract_id = c.id
        INNER JOIN payments p ON p.invoice_id  = i.id
        WHERE i.status        = 'PAID'
          AND i.billing_month = $1
          AND c.status        = 'ACTIVE'
          AND c.deleted_at    IS NULL
          AND i.deleted_at    IS NULL
          AND p.deleted_at    IS NULL
          ${advisorFilter}
        GROUP BY i.id, i.paid_amount
      )
      SELECT
        SUM(CASE WHEN processing_qty = 0 AND completed_qty > 0 THEN 1            ELSE 0 END) AS facturas_verificadas,
        COALESCE(SUM(CASE WHEN processing_qty = 0 AND completed_qty > 0 THEN paid_amount    ELSE 0 END), 0) AS monto_verificado,
        COALESCE(SUM(CASE WHEN processing_qty = 0 AND completed_qty > 0 THEN paid_amount_bs ELSE 0 END), 0) AS monto_verificado_bs,
        SUM(CASE WHEN processing_qty > 0 THEN 1            ELSE 0 END)                       AS facturas_pendientes_verificar,
        COALESCE(SUM(CASE WHEN processing_qty > 0 THEN paid_amount    ELSE 0 END), 0)        AS monto_sin_verificar,
        COALESCE(SUM(CASE WHEN processing_qty > 0 THEN paid_amount_bs ELSE 0 END), 0)        AS monto_sin_verificar_bs
      FROM EstadoFacturas;
    `;
    const rows = await this.datasource.query<VerificationKpiRaw[]>(sql, params);
    return (
      rows[0] ?? {
        facturas_verificadas: '0',
        monto_verificado: '0',
        monto_verificado_bs: '0',
        facturas_pendientes_verificar: '0',
        monto_sin_verificar: '0',
        monto_sin_verificar_bs: '0',
      }
    );
  }

  /* ──────────────────────────────────────────────────────────────────────
     Query 2 — Resumen global del estado de facturas (contratos activos).
     ────────────────────────────────────────────────────────────────────── */
  private async queryInvoiceSummary(
    billingMonth: string,
    advisorUuid?: string,
  ): Promise<InvoiceSummaryRaw> {
    const params: unknown[] = [billingMonth];
    const advisorFilter = advisorUuid ? `AND c.advisor_id = $${params.push(advisorUuid)}` : '';

    const sql = `
      SELECT
        SUM(CASE WHEN i.status = 'PAID'    THEN 1              ELSE 0 END) AS invoices_paid,
        SUM(CASE WHEN i.status = 'PAID'    THEN i.paid_amount  ELSE 0 END) AS total_paid,
        SUM(CASE WHEN i.status = 'PARTIAL' AND NOT EXISTS (
          SELECT 1 FROM payments p 
          WHERE p.invoice_id = i.id 
            AND p.status = 'REJECTED' 
            AND p.deleted_at IS NULL
        ) THEN 1 ELSE 0 END) AS invoices_partial,
        SUM(CASE WHEN i.status = 'PARTIAL' THEN i.paid_amount  ELSE 0 END) AS total_partial,
        SUM(CASE WHEN i.status = 'PARTIAL' THEN i.total_amount ELSE 0 END) AS total_partial_to_paid,
        SUM(CASE WHEN i.status = 'PENDING' AND NOT EXISTS (
          SELECT 1 FROM payments p 
          WHERE p.invoice_id = i.id 
            AND p.status = 'REJECTED' 
            AND p.deleted_at IS NULL
        ) THEN 1 ELSE 0 END) AS invoices_pending,
        SUM(CASE WHEN i.status = 'PENDING' THEN i.total_amount ELSE 0 END) AS total_pending,
        COALESCE(SUM(i.base_amount), 0)                                     AS grand_total_amount,
        COALESCE(SUM(CASE WHEN i.status IN ('PAID', 'PARTIAL') THEN i.paid_amount ELSE 0 END), 0) AS total_collected
      FROM invoices i
      INNER JOIN contracts c ON c.id = i.contract_id
      WHERE c.status      = 'ACTIVE'
        AND c.deleted_at  IS NULL
        AND i.deleted_at  IS NULL
        AND i.billing_month = $1
        ${advisorFilter};
    `;
    const rows = await this.datasource.query<InvoiceSummaryRaw[]>(sql, params);
    return (
      rows[0] ?? {
        invoices_paid: '0',
        total_paid: '0',
        invoices_partial: '0',
        total_partial: '0',
        total_partial_to_paid: '0',
        invoices_pending: '0',
        total_pending: '0',
        grand_total_amount: '0',
        total_collected: '0',
      }
    );
  }

  /* ──────────────────────────────────────────────────────────────────────
     Query 3 — Tendencia mensual (últimos 12 billing_month de contratos activos)
     ────────────────────────────────────────────────────────────────────── */
  private async queryMonthlyTrend(advisorUuid?: string): Promise<MonthlyTrendRaw[]> {
    const params: unknown[] = [];
    const advisorFilter = advisorUuid ? `AND c.advisor_id = $${params.push(advisorUuid)}` : '';

    const sql = `
      SELECT
        i.billing_month                                                       AS month,
        SUM(CASE WHEN i.status = 'PAID'                  THEN 1 ELSE 0 END)  AS verified,
        SUM(CASE WHEN i.status IN ('PENDING', 'PARTIAL') THEN 1 ELSE 0 END)  AS pending
      FROM invoices i
      INNER JOIN contracts c ON c.id = i.contract_id
      WHERE c.status         = 'ACTIVE'
        AND i.billing_month IS NOT NULL
        AND i.deleted_at IS NULL
        AND c.deleted_at IS NULL
        ${advisorFilter}
      GROUP BY i.billing_month
      ORDER BY i.billing_month DESC
      LIMIT 12;
    `;

    return this.datasource.query<MonthlyTrendRaw[]>(sql, params);
  }

  /* ──────────────────────────────────────────────────────────────────────
     Mappers — convierten raw rows a las interfaces del dashboard
     ────────────────────────────────────────────────────────────────────── */

  private buildSummary(kpi: VerificationKpiRaw, inv: InvoiceSummaryRaw): StatisticsSummary {
    const partialRemaining = Number(inv.total_partial_to_paid) - Number(inv.total_partial);

    return {
      totalPaymentsVerified: Number(kpi.facturas_verificadas),
      totalPaymentsUnverified: Number(kpi.facturas_pendientes_verificar),
      totalPaymentsPartial: Number(inv.invoices_partial),
      totalPaymentsPending: Number(inv.invoices_pending),
      totalAmountVerifiedUsd: Number(kpi.monto_verificado),
      totalAmountUnverifiedUsd: Number(kpi.monto_sin_verificar),
      totalPendingUsd: Number(inv.total_pending),
      totalToPayUsd: partialRemaining + Number(inv.total_pending),
      /** Grand total of ALL invoice total_amounts for the billing month */
      totalInvoiceAmount: Number(inv.grand_total_amount),
      /** Total actually collected: paid_amount of PAID + PARTIAL invoices */
      totalCollected: Number(inv.total_collected),
    };
  }

  private buildBreakdown(kpi: VerificationKpiRaw, inv: InvoiceSummaryRaw): PaymentBreakdown[] {
    return [
      {
        status: 'verified',
        count: Number(kpi.facturas_verificadas),
        amountUsd: Number(kpi.monto_verificado),
        amountBs: Number(kpi.monto_verificado_bs),
      },
      {
        status: 'unverified',
        count: Number(kpi.facturas_pendientes_verificar),
        amountUsd: Number(kpi.monto_sin_verificar),
        amountBs: Number(kpi.monto_sin_verificar_bs),
      },
      {
        status: 'partial',
        count: Number(inv.invoices_partial),
        amountUsd: Number(inv.total_partial),
        amountBs: 0, // facturas PARTIAL: sin columna Bs en invoices
      },
      {
        status: 'pending',
        count: Number(inv.invoices_pending),
        amountUsd: Number(inv.total_pending),
        amountBs: 0, // facturas sin pago aún → no hay amount_bs registrado
      },
    ];
  }
}
