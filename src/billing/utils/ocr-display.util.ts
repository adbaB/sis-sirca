/**
 * Extracts bancoDestino and formatted montoExtraido from payment OCR metadata.
 * Shared between the PDF cron service and the invoice PDF endpoint.
 */
export function extractOcrDisplayFields(metadata: Record<string, unknown> | null | undefined): {
  bancoDestino: string | null;
  montoExtraido: string | null;
} {
  const meta = (metadata || {}) as Record<string, unknown>;
  const bancoDestino = (meta.bancoDestino as string) || null;

  const montoRaw = meta.monto != null ? Number(meta.monto) : null;
  const moneda = (meta.moneda as string) || '';

  const formatted = new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const montoExtraido =
    montoRaw != null
      ? moneda.toUpperCase() === 'USD'
        ? `$${formatted.format(montoRaw)}`
        : `Bs. ${formatted.format(montoRaw)}`
      : null;

  return { bancoDestino, montoExtraido };
}
