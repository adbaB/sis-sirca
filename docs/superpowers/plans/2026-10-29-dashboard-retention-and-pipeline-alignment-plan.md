# Plan de Implementación: Alineación de Retenciones, Facturación y Pipeline

**Fecha**: 2026-10-29  
**Especificación**: [`docs/superpowers/specs/2026-10-29-dashboard-retention-and-pipeline-alignment-design.md`](../specs/2026-10-29-dashboard-retention-and-pipeline-alignment-design.md)  
**Ramas**: `fix-dashboard-retention-alignment` (en `sis-sirca` y `sirca-front-app`)

---

## Fases de Implementación

### Fase 1: Backend - Ajuste en `StatisticsService` (`sis-sirca`)
- [ ] 1.1. Modificar `src/statistics/interfaces/response.interface.ts` para agregar `totalRetentionAmount`, `totalBaseAmount`, `subscriptionFeesCount` y `subscriptionFeesAmount` a `StatisticsSummary`.
- [ ] 1.2. Actualizar `queryInvoiceSummary` en `src/statistics/services/statistics.service.ts` para sumar `i.retention_amount` y `i.base_amount`.
- [ ] 1.3. Agregar consulta para obtener conteo y suma de líneas `SUSCRIPCION` en el mes de facturación.
- [ ] 1.4. Actualizar `buildSummary` para asignar las nuevas propiedades y calcular `totalPendingUsd` deduciendo retenciones fiscales.
- [ ] 1.5. Actualizar y ejecutar tests unitarios de `statistics.service.spec.ts`.

### Fase 2: Backend - Ajuste en `ContractStatisticsService` (`sis-sirca`)
- [ ] 2.1. En `src/contracts/services/contract-statistics.service.ts` (`classifyContractByMonth`), cambiar `.find()` por `.filter()` para acumular todas las facturas del contrato en el mes de facturación.
- [ ] 2.2. Homologar el cálculo del total facturado y saldo exigible neto deduciendo retención.
- [ ] 2.3. Actualizar y ejecutar tests unitarios de `contract-statistics.service.spec.ts`.
- [ ] 2.4. Verificar con `npm run check-types` y `npm run test` en `sis-sirca`.

### Fase 3: Frontend - Integración en `sirca-front-app`
- [ ] 3.1. Actualizar `lib/types.ts` con los nuevos campos de `StatisticsSummary`.
- [ ] 3.2. Modificar `components/dashboard/PartialPaymentChart.tsx`:
  - Recibir `totalRetentionAmount`.
  - Calcular `remaining = Math.max(0, totalInvoiceAmount - (totalRetentionAmount ?? 0) - totalCollected)`.
  - Mostrar la métrica de Retenciones en el pie de la gráfica.
- [ ] 3.3. En `components/dashboard/contracts/AdvisorConsole.tsx`, agregar el desglose informativo en la tarjeta de facturación (cartera recurrente vs cuotas de apertura/adicionales).
- [ ] 3.4. Validar compilación en `sirca-front-app` (`pnpm build` / `npm run build`).

### Fase 4: Verificación Final y Auditoría
- [ ] 4.1. Ejecutar auditorías de calidad en `sis-sirca` (`npm run audit:lines`, `npm run check-types`, `npm run test`).
- [ ] 4.2. Comprobar que los números coinciden de manera transparente entre ambas pantallas.
