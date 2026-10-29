# Glosario de Dominio y Lenguaje Ubicuo — SIS-SIRCA

Este documento define el vocabulario oficial de negocio y su correspondencia exacta en el código, la base de datos PostgreSQL y las pruebas (`*.spec.ts`) de **SIS-SIRCA**. Todo agente de IA o desarrollador debe utilizar estos términos de manera consistente antes de diseñar, crear o refactorizar cualquier módulo.

---

## 1. Actores y Roles del Sistema

| Término en Negocio (ES) | Término en Código / Entidad | Autenticación / Permisos | Descripción e Invariantes |
| :--- | :--- | :--- | :--- |
| **Usuario Interno / Operador** | [`User`](src/users/entities/user.entity.ts) + [`Role`](src/roles/entities/role.entity.ts) | JWT + `@RequirePermissions(...)` | Personal administrativo u operativo de SIRCA. Sus acciones están acotadas por permisos granulares (`Permission`, ej. `read:eventualities`, `approve:payments`). |
| **Médico APS / Triaje** | [`Doctor`](src/doctors/entities/doctor.entity.ts) (vinculado a `User`) | JWT + `@RequirePermissions('attend:aps', ...)` | Médico de Atención Primaria de Salud que reclama pacientes en cola (`DOCTOR_QUEUE`), registra signos vitales/diagnósticos CIE-10 y emite informes médicos u órdenes de servicio. |
| **Asesor Comercial** | [`Advisor`](src/advisors/entities/advisor.entity.ts) | Entidad de negocio | Corredor o asesor que capta contratos. Puede percibir una comisión (`advisorCommission`) parametrizada en el contrato. |
| **Titular / Responsable de Pago** | [`ContractPerson`](src/contracts/entities/contract-person.entity.ts) (`PersonRole.TITULAR`) | Canal Web / Chatbot WhatsApp | Persona principal del contrato. Solo puede existir **un único responsable de facturación activo** (`isBillingOwner = true`) por contrato (`UQ_contract_person_billing_owner`). |
| **Afiliado / Beneficiario** | [`ContractPerson`](src/contracts/entities/contract-person.entity.ts) (`PersonRole.AFILIADO`) | Canal Web / Chatbot WhatsApp | Familiar o dependiente incluido en un contrato con un vínculo (`Parentesco`), plan asignado y su propio período de cobertura individual. |

---

## 2. Entidades Nucleares del Dominio

### 2.1 Personas, Planes y Contratos

| Concepto (ES) | Clase / Entidad (`src/`) | Tabla PostgreSQL | Reglas de Negocio e Invariantes Clave |
| :--- | :--- | :--- | :--- |
| **Persona** | [`Person`](src/persons/entities/person.entity.ts) | `persons` | Registro único de identidad física/jurídica por `(type_identity_card, identity_card)`. Puede participar en uno o más contratos a lo largo del tiempo. |
| **Plan de Salud** | [`Plan`](src/plans/entities/plan.entity.ts) | `plans` | Producto de cobertura médica con tarifa mensual base (`amount`), monto de cobertura anual y reglas de edad máxima (`maxAge`). |
| **Servicio Médico / Baremo** | [`MedicalService`](src/plans/entities/medical-service.entity.ts) & [`PlanService`](src/plans/entities/plan-service.entity.ts) | `medical_services` / `plan_services` | Catálogo de prestaciones médicas agrupadas por [`ServiceCategory`](src/plans/entities/service-category.entity.ts) (`service_categories`) con su costo baremo y cobertura por plan. |
| **Contrato** | [`Contract`](src/contracts/entities/contract.entity.ts) | `contracts` | Acuerdo comercial identificado por `code` único. Define día de corte (`cutoffDay` entre 1 y 31), retención (`retentionPercentage`), comisión (`advisorCommission`) y estado (`ContractStatus`). |
| **Cartera** | [`Portfolio`](src/portfolios/entities/portfolio.entity.ts) | `portfolios` | Agrupación comercial o corporativa a la que pertenece un conjunto de contratos. |
| **Afiliación Contrato-Persona** | [`ContractPerson`](src/contracts/entities/contract-person.entity.ts) | `contract_persons` | Vínculo activo entre `Contract` y `Person`. Registra rol (`TITULAR` o `AFILIADO`), plan específico, parentesco y `affiliationDate`. Único activo por `(contract_id, person_id)`. |
| **Período de Cobertura** | [`ContractCoveragePeriod`](src/contracts/entities/contract-coverage-period.entity.ts) | `contract_coverage_periods` | Bolsillo financiero de cobertura de un `ContractPerson` en una vigencia (`startDate` a `expirationDate`). Solo puede haber **un período `ACTIVE`** por afiliado (`UQ_ccp_active_person_period`). |
| **Declaración de Salud** | [`HealthDeclaration`](src/contracts/entities/health-declaration.entity.ts) | `health_declarations` | Cuestionario médico de preexistencias registrado para un `ContractPerson` al afiliarse. |
| **Exclusión Médica** | [`ContractPersonExclusion`](src/contracts/entities/contract-person-exclusion.entity.ts) | `contract_person_exclusions` | Patología o condición excluida de cobertura para un afiliado específico dentro de su contrato. |
| **Historial de Afiliación** | [`AffiliationHistory`](src/contracts/entities/affiliation-history.entity.ts) | `affiliation_histories` | Bitácora de altas, bajas y reactivaciones de personas dentro de los contratos para reportes de afiliación/desafiliación. |

### 2.2 Facturación, Cobranza y Tasa Cambiaria

| Concepto (ES) | Clase / Entidad (`src/`) | Tabla PostgreSQL | Reglas de Negocio e Invariantes Clave |
| :--- | :--- | :--- | :--- |
| **Factura Mensual** | [`Invoice`](src/billing/invoices/entities/invoice.entity.ts) | `invoices` | Obligación de cobro mensual (`billingMonth` formato `YYYY-MM`) única por contrato. Invariante en BD: `total_amount >= 0`, `paid_amount >= 0` y `paid_amount <= total_amount`. |
| **Línea de Factura** | [`InvoiceLine`](src/billing/invoices/entities/invoice-line.entity.ts) | `invoice_lines` | Desglose de cada cargo dentro de una factura (cuota de suscripción por afiliado/plan o cargos administrativos). |
| **Pago** | [`Payment`](src/billing/payments/entities/payment.entity.ts) | `payments` | Abono reportado vía `WEB` o `BOT` (WhatsApp) en USD (`amount`) y/o Bolívares (`amountBs`), respaldado por comprobante en S3 y validado por OCR/administración. |
| **Sobrante (Saldo a Favor)** | [`Surplus`](src/billing/payments/entities/surplus.entity.ts) | `surpluses` | Excedente generado cuando un pago supera el saldo pendiente de una factura. Se aplica automáticamente a facturas futuras del mismo contrato. |
| **Tasa de Cambio BCV** | [`ExchangeRate`](src/exchange-rate/entities/Exchange-rate.entity.ts) | `exchange_rates` | Tasa oficial diaria (`rateUsd`, `rateEur` en Bs) utilizada para conversión multimoneda en cobros y liquidación de consumos clínicos. |

### 2.3 Gestión Clínica, Siniestros y Eventualidades

| Concepto (ES) | Clase / Entidad (`src/`) | Tabla PostgreSQL | Reglas de Negocio e Invariantes Clave |
| :--- | :--- | :--- | :--- |
| **Eventualidad / Siniestro** | [`Eventuality`](src/eventualities/entities/eventuality.entity.ts) | `eventualities` | Evento de atención médica de un afiliado (`EMERGENCY`, `HOSPITALIZATION`, `APS`, `CONSULTATION`, `STUDY`) con número de siniestro único (`claimNumber`). |
| **Informe Médico** | [`EventualityMedicalReport`](src/eventualities/entities/eventuality-medical-report.entity.ts) | `eventuality_medical_reports` | Evaluación clínica estructurada (motivo de consulta, antecedentes, examen físico, diagnósticos CIE-10, indicaciones) o documento PDF subido a S3 y procesado por OCR. |
| **Ítem de Hoja de Consumo** | [`EventualityTreatmentItem`](src/eventualities/entities/eventuality-treatment-item.entity.ts) | `eventuality_treatment_items` | Renglón de gasto médico/insumo/servicio consumido durante la eventualidad, conciliando costo proveedor vs. monto cubierto por SIRCA. |
| **Orden de Servicio** | [`EventualityServiceRequest`](src/eventualities/entities/eventuality-service-request.entity.ts) | `eventuality_service_requests` | Solicitud médica derivada de una atención (ej. laboratorio, imagenología o interconsulta generada en APS) que puede originar una eventualidad hija (`parentEventuality`). |
| **Factura de Proveedor** | [`EventualityProviderInvoice`](src/eventualities/entities/eventuality-provider-invoice.entity.ts) | `eventuality_provider_invoices` | Factura fiscal emitida por la clínica o proveedor de salud contra SIRCA por la atención de una eventualidad. |
| **Movimiento de Cobertura** | [`EventualityMovement`](src/eventualities/entities/eventuality-movement.entity.ts) | `eventuality_movements` | Registro contable de reserva, deducción o liberación de cobertura sobre el `ContractCoveragePeriod` asociado a la eventualidad. |
| **Catálogo CIE-10** | [`Cie10Code`](src/cie10/entities/cie10-code.entity.ts) | `cie10_codes` | Clasificación Internacional de Enfermedades (OMS) utilizada para estandarizar diagnósticos médicos y validar exclusiones. |

---

## 3. Ciclos de Vida, Estados e Invariantes del Dominio

### 3.1 Ciclo de Vida del Contrato (`ContractStatus`) y Carencia
- `ACTIVE` (**Activo**): Contrato al día con cobertura habilitada para sus afiliados elegibles.
- `SUSPENDED` (**Suspendido por Mora**): Cuando un contrato tiene facturas vencidas pasado su `cutoffDay`, pasa a `SUSPENDED`.
  - **Reactivación con Carencia de 7 Días**: Al saldar la deuda total de un contrato suspendido, el contrato vuelve a `ACTIVE`, pero establece `reactivationEligibleAt = fechaPago + 7 días`. Durante esa ventana de carencia, el afiliado aún no recupera elegibilidad automática para atenciones no urgentes.
- `INACTIVE` (**Inactivo / Desafiliado**): Contrato finalizado o dado de baja.

### 3.2 Ecuación Invariante del Período de Cobertura (`ContractCoveragePeriod`)
Todo movimiento de reserva o consumo clínico debe preservar la invariante financiera sobre montos `NUMERIC(10, 2)`:
$$\text{remainingCoverage} = \max\left(0,\; \text{initialCoverage} - \text{consumedCoverage} - \text{reservedCoverage}\right)$$
- Ninguno de los cuatro campos (`initial_coverage`, `consumed_coverage`, `reserved_coverage`, `remaining_coverage`) puede ser negativo (`CHECK >= 0`).

### 3.3 Ciclo de Vida de una Eventualidad (`EventualityStatus`)
- `PENDING_APPROVAL` (**Pendiente de Aprobación**): Ingreso inicial de emergencia/hospitalización pendiente de autorización administrativa.
- `CLINIC_PROCESS` (**En Proceso Clínico**): Emergencia aprobada o caso en curso dentro del centro de salud.
- `DOCTOR_QUEUE` (**En Cola Médica APS**): Paciente admitido para consulta de Atención Primaria esperando ser reclamado (`claimPatient`) por un médico.
- `SCHEDULED` (**Agendado**): Consulta o estudio programado a partir de una orden de servicio.
- `WAITING_INVOICE` (**Esperando Factura**): Atención médica concluida pendiente de recepción/conciliación de factura del proveedor.
- `UNDER_ADMIN_REVIEW` (**En Revisión Administrativa**): Auditoría de consumos, baremos y soportes antes del cierre definitivo.
- `CLOSED` (**Cerrado**): Siniestro liquidado; la cobertura reservada se consolida en cobertura consumida (`consumedCoverage`).
- `CANCELLED` / `REJECTED` (**Cancelado / Rechazado**): Caso anulado o denegado; libera cualquier monto previamente reservado (`reservedCoverage`).
