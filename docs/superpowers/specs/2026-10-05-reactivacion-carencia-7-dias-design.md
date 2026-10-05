# Diseño Técnico: Carencia de Reactivación de Contratos Suspendidos (7 Días)

- **Fecha:** 2026-10-05
- **Estado:** Implementado y Aprobado
- **Autor:** Antigravity & Equipo SIRCA

---

## 1. Contexto y Regla de Negocio

En el sistema **SIRCA**, cuando un contrato en estado `SUSPENDED` salda sus facturas vencidas o reporta un pago activo (`PROCESSING` o `COMPLETED`), entra en un período de carencia antes de su reactivación automática o manual.

### Regla de Negocio
1. **Período de Carencia:** **7 días continuos / calendario** (incluye fines de semana y feriados).
2. **Conteo:** El día 1 cuenta como el día en que se realizó el pago (`operationDate`).
   * Ejemplo: Si el cliente paga el día 2 del mes:
     * Día 1 de carencia: Día 2 (fecha de pago)
     * Día 2 de carencia: Día 3
     * Día 3 de carencia: Día 4
     * Día 4 de carencia: Día 5
     * Día 5 de carencia: Día 6
     * Día 6 de carencia: Día 7
     * Día 7 de carencia: Día 8
   * El contrato queda formalmente elegible para reactivación a partir de las **00:00:00 del día 9** (`operation_date + 7 días`).
3. **Constante Centralizada:** Se define `REACTIVATION_COOLDOWN_DAYS = 7` en `src/contracts/constants/contract.constants.ts`.
4. **Normalización de Zona Horaria:** Se normaliza la fecha con `normalizeDateOnly` y `CARACAS_ZONE` (`America/Caracas`) para evitar desfases por conversión UTC-4.

---

## 2. Archivos Afectados

1. `src/contracts/constants/contract.constants.ts`:
   * Exporta `REACTIVATION_COOLDOWN_DAYS = 7`.
2. `src/contracts/services/contract-reactivation.service.ts`:
   * Aplica `plus({ days: REACTIVATION_COOLDOWN_DAYS })` a la fecha base con `normalizeDateOnly`.
3. `src/contracts/crons/contract-reactivation.cron.ts`:
   * Logs informativos dinámicos utilizando `REACTIVATION_COOLDOWN_DAYS`.
4. `src/contracts/services/contract-lifecycle.service.ts`:
   * Validación post-suspensión documentada a 7 días.
5. Pruebas Unitarias:
   * `src/contracts/services/contract-reactivation.service.spec.ts`: Verifica que con pago el `2026-08-01`, la fecha de elegibilidad sea `2026-08-08` (7 días continuos).
   * `src/contracts/tests/contract-lifecycle.service.spec.ts`: Verifica cálculo y persistencia de elegibilidad.
