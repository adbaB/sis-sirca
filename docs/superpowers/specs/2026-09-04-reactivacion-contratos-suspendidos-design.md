# Diseño Técnico: Reactivación de Contratos Suspendidos (Período de Carencia de 7 Días)

- **Fecha:** 2026-09-04
- **Estado:** Aprobado para Planificación
- **Autor / Arquitectura:** Antigravity & Equipo SIRCA

---

## 1. Contexto y Regla de Negocio

En el sistema **SIRCA**, cuando un contrato entra en estado `SUSPENDED` debido a morosidad (corte de pago sin saldar), se debe aplicar una política de carencia para su reactivación:

1. **Período de Carencia:** Deben transcurrir **7 días corridos** contados a partir de la fecha de operación (`operation_date`) del pago reportado o aprobado.
2. **Estados de Pago Válidos:** Se consideran pagos en estado `PROCESSING` (reportados y en revisión) y `COMPLETED` (aprobados). Los pagos en estado `REJECTED` se ignoran completamente.
3. **Criterio de Solvencia:** El contrato debe estar solvente para ser reactivado (sin facturas vencidas impagas pendientes).
4. **Reactivación Automática:** Un proceso programado (Cron diario) evalúa los contratos suspendidos que hayan cumplido los 7 días continuos y los reactiva a `ACTIVE` automáticamente, siempre y cuando sus pagos estén formalmente `COMPLETED`.
5. **Reactivación Manual con Excepción (Bypass):** Se habilita la posibilidad de reactivación manual antes de los 7 días o incluso con deuda pendiente para usuarios con un permiso especial (`override:contract-reactivation`), exigiendo de forma obligatoria un motivo (`reason`) para auditoría.
6. **Histórico de Afiliación:** A diferencia de la inactivación (`INACTIVE`), la suspensión temporal (`SUSPENDED`) no desafilia a las personas en `affiliation_history`. Por tanto, la reactivación desde `SUSPENDED` no genera ni revierte registros en el historial de afiliación; únicamente actualiza el estado del contrato a `ACTIVE` y limpia el motivo de suspensión.

---

## 2. Modelo de Datos y Migraciones

### 2.1 Entidad `Contract` (`src/contracts/entities/contract.entity.ts`)
Se añade la propiedad `reactivationEligibleAt`:
```typescript
@Column({
  type: 'timestamptz',
  nullable: true,
  name: 'reactivation_eligible_at',
})
reactivationEligibleAt?: Date | null;
```

### 2.2 Migración de Base de Datos
* Agrega la columna `reactivation_eligible_at` a la tabla `contracts`.
* Crea un índice parcial para optimizar el rendimiento del Cron diario:
  ```sql
  ALTER TABLE "contracts" ADD "reactivation_eligible_at" TIMESTAMP WITH TIME ZONE NULL;
  CREATE INDEX "IDX_contracts_status_reactivation_eligible_at" 
  ON "contracts" ("status", "reactivation_eligible_at") 
  WHERE "status" = 'SUSPENDED';
  ```

### 2.3 Sistema RBAC (Permisos y Roles)
* Se registra un nuevo permiso en la tabla `permissions`:
  * `name`: `override:contract-reactivation`
  * `description`: `Permiso para reactivar contratos suspendidos antes del plazo de 7 días o con deuda pendiente (bypass)`
* Se asigna automáticamente al rol `admin`.

### 2.4 DTOs
* Se crea `ActivateContractDto` (`src/contracts/dto/activate-contract.dto.ts`):
  ```typescript
  import { IsOptional, IsString, MaxLength } from 'class-validator';

  export class ActivateContractDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
  }
  ```

---

## 3. Arquitectura y Flujo de Componentes

### 3.1 Diagrama de Estados y Flujo

```mermaid
flowchart TD
    S[Contrato SUSPENDED] --> P[Registro / Aprobación de Pago]
    P --> CHK{¿Estado del Pago?}
    CHK -->|REJECTED| R[reactivation_eligible_at = null]
    CHK -->|PROCESSING o COMPLETED| SOLV{¿Cubre facturas vencidas?}
    SOLV -->|No| R
    SOLV -->|Sí| CALC["reactivation_eligible_at = operation_date + 7 días corridos"]

    CALC --> CRON[Cron Diario 2:00 AM]
    CRON --> TIME{"¿reactivation_eligible_at <= NOW()?"}
    TIME -->|No| WAIT[Esperar siguiente ejecución]
    TIME -->|Sí| STAT{"¿Pagos en COMPLETED?"}
    STAT -->|No: Sigue en PROCESSING| LOG[Registrar log: Pendiente aprobación administrativa]
    STAT -->|Sí: Solvente 100%| ACT[Reactivar contrato a ACTIVE]

    S --> MAN[PATCH /contracts/:id/activate]
    MAN --> PERM{"¿Tiene permiso override:contract-reactivation?"}
    PERM -->|No| REG_CHK{"¿Cumplió 7 días y 100% solvente?"}
    REG_CHK -->|No| ERR[400 Bad Request: Carencia activa / Facturas pendientes]
    REG_CHK -->|Sí| ACT
    PERM -->|Sí (Bypass)| REAS{"¿Envió motivo (reason)?"}
    REAS -->|No| ERR_REAS[400 Bad Request: Motivo obligatorio para bypass]
    REAS -->|Sí| ACT_BYPASS[Reactivar a ACTIVE + Log de Auditoría]
```

### 3.2 Cálculo y Mantenimiento de `reactivation_eligible_at`
Un método auxiliar (ej. `syncContractReactivationEligibility(contractId, manager?)`) se ejecuta en los siguientes eventos:
1. **Creación de Pago (`PaymentCreationService`):** Si el contrato está `SUSPENDED`, evalúa la solvencia proyectada sumando pagos `COMPLETED` + `PROCESSING`. Si cubre las facturas vencidas, asigna `operation_date + 7 días`.
2. **Aprobación de Pago (`PaymentStateService.approvePayment`):** Confirma la solvencia definitiva del contrato.
3. **Rechazo de Pago (`PaymentStateService.rejectPayment`):** Si el rechazo genera un descubierto en las facturas vencidas, anula `reactivation_eligible_at = null`.

### 3.3 Cron de Reactivación (`ContractReactivationCron`)
* **Ubicación:** `src/contracts/crons/contract-reactivation.cron.ts`
* **Programación:** `@Cron('0 2 * * *')` (2:00 AM America/Caracas).
* **Comportamiento:**
  1. Busca en bloques (`take: 100`) contratos `status = 'SUSPENDED'` con `reactivation_eligible_at <= NOW()`.
  2. Verifica que las facturas vencidas estén completamente saldadas con pagos `COMPLETED`.
  3. Ejecuta `contractLifecycleService.activate(contract.id)`.
  4. Registra en el `Logger` de NestJS los contratos reactivados y los omitidos por pagos en `PROCESSING`.

### 3.4 Modificación en `ContractLifecycleService.activate`
* Firma actualizada: `activate(contractId: string, dto?: ActivateContractDto, user?: RequestUser)`.
* Si `contract.status === ContractStatus.SUSPENDED`:
  * **Sin permiso de excepción:**
    * Verifica que no existan facturas vencidas impagas.
    * Verifica que `reactivationEligibleAt` se haya alcanzado.
    * Si no se cumple, arroja `BadRequestException`.
  * **Con permiso de excepción (`override:contract-reactivation`):**
    * Si no se han cumplido los 7 días o existen facturas impagas, exige `dto?.reason`.
    * Registra en logs de auditoría: `Bypass de reactivación ejecutado por ${user?.email} para contrato ${contract.code}. Motivo: ${dto.reason}`.
  * Cambia el estado a `ACTIVE`, resetea `inactivationReason = null` y `reactivationEligibleAt = null`.

---

## 4. Plan de Pruebas y Validación

### 4.1 Pruebas Unitarias
* **`contract-lifecycle.service.spec.ts`**:
  * Reactivación normal exitosa cumpliendo 7 días y solvencia.
  * Rechazo con `400` para usuario normal antes de los 7 días.
  * Rechazo con `400` para usuario normal con deuda vencida.
  * Rechazo con `400` para usuario con permiso de excepción si omite `reason`.
  * Aprobación de bypass con permiso de excepción y `reason` documentado.
* **`contract-reactivation.cron.spec.ts`**:
  * Reactivación automática de contratos elegibles y solventes.
  * Espera de contratos cuyos pagos aún están en `PROCESSING`.
  * Omisión de contratos con fecha futura.
* **Sincronización de fecha de elegibilidad**:
  * Cálculo correcto a partir de `operation_date + 7 días`.
  * Reseteo a `null` si el pago es rechazado.

### 4.2 Verificación de Migraciones
* Creación de columna e índice en PostgreSQL.
* Creación de nuevo permiso en `permissions` y asignación a rol `admin`.
