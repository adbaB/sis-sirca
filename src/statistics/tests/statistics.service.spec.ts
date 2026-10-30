import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { StatisticsService } from '../services/statistics.service';

describe('StatisticsService', () => {
  let service: StatisticsService;
  let dataSourceMock: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    dataSourceMock = {
      query: vi.fn(),
    };
    service = new StatisticsService(dataSourceMock as unknown as DataSource);
  });

  it('calculates statistics correctly discounting retentions from pending balance', async () => {
    dataSourceMock.query
      // queryVerificationKpi
      .mockResolvedValueOnce([
        {
          facturas_verificadas: '10',
          monto_verificado: '500',
          monto_verificado_bs: '20000',
          facturas_pendientes_verificar: '2',
          monto_sin_verificar: '100',
          monto_sin_verificar_bs: '4000',
        },
      ])
      // queryInvoiceSummary
      .mockResolvedValueOnce([
        {
          invoices_paid: '10',
          total_paid: '500',
          invoices_partial: '2',
          total_partial: '100',
          total_partial_to_paid: '150',
          invoices_pending: '3',
          total_pending: '300',
          grand_total_amount: '1000',
          total_base_amount: '900',
          total_retention: '50',
          total_collected: '600',
        },
      ])
      // queryAffiliatesAndSubscriptions
      .mockResolvedValueOnce([
        {
          total_affiliates: '25',
          subscription_count: '4',
          subscription_amount: '20',
        },
      ]);

    const result = await service.getStatistics('2026-10');

    expect(result.summary.totalInvoiceAmount).toBe(1000);
    expect(result.summary.totalBaseAmount).toBe(900);
    expect(result.summary.totalRetentionAmount).toBe(50);
    expect(result.summary.totalCollected).toBe(600);
    // netDue = 1000 - 50 = 950. realPending = 950 - 600 = 350
    expect(result.summary.totalPendingUsd).toBe(350);
    expect(result.summary.totalToPayUsd).toBe(350);
    expect(result.summary.totalAffiliates).toBe(25);
    expect(result.summary.subscriptionFeesCount).toBe(4);
    expect(result.summary.subscriptionFeesAmount).toBe(20);

    expect(result.breakdown).toHaveLength(4);
    expect(result.breakdown[0].status).toBe('verified');
    expect(result.breakdown[0].count).toBe(10);
  });

  it('applies advisorUuid filter when provided', async () => {
    dataSourceMock.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getStatistics('2026-10', 'adv-uuid-123');

    expect(dataSourceMock.query).toHaveBeenCalledTimes(3);
    const calls = dataSourceMock.query.mock.calls;
    // Check that params include advisorUuid
    expect(calls[0][1]).toContain('adv-uuid-123');
    expect(calls[1][1]).toContain('adv-uuid-123');
    expect(calls[2][1]).toContain('adv-uuid-123');

    expect(result.summary.totalInvoiceAmount).toBe(0);
    expect(result.summary.totalRetentionAmount).toBe(0);
    expect(result.summary.totalPendingUsd).toBe(0);
  });
});
