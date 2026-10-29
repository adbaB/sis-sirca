# Plan de Implementación: Refactorización Modular de `EventualitiesModule`

**Especificación:** [docs/superpowers/specs/2026-10-27-eventualities-refactoring-and-architecture-governance-design.md](file:///c:/Users/User/Proyectos/sirca/sis-sirca/docs/superpowers/specs/2026-10-27-eventualities-refactoring-and-architecture-governance-design.md)  
**Fecha:** 2026-10-27  
**Módulo:** `src/eventualities`

---

## Tareas por Fases (Patrón Strangler Fig / Cero Tiempo de Inactividad)

### Fase 1: Helpers Puros y Consultas Base (`Query` & `ServiceRequest`)
- [ ] **1.1**: Crear `src/eventualities/helpers/eventuality-consumption.helper.ts` con funciones puras de conversión monetaria, cálculo de cobertura vs. exceso y validación de alertas, junto con su test `eventuality-consumption.helper.spec.ts`.
- [ ] **1.2**: Extraer `EventualityQueryService` (`findOne`, `findAll`) en `src/eventualities/services/eventuality-query.service.ts` (≤100 líneas) y delegar desde `EventualitiesService`.
- [ ] **1.3**: Extraer `EventualityServiceRequestService` (`getServiceRequests`, `cancelServiceRequest`) en `src/eventualities/services/eventuality-service-request.service.ts` (≤110 líneas) y delegar desde `EventualitiesService`.

### Fase 2: Informes Médicos y Facturas de Proveedores (`MedicalReport` & `ProviderInvoice`)
- [ ] **2.1**: Extraer `EventualityMedicalReportService` (`uploadMedicalReport`, `extractMedicalReportInBackground`, `getMedicalReport`, `updateMedicalReportData`) en `src/eventualities/services/eventuality-medical-report.service.ts` (≤220 líneas).
- [ ] **2.2**: Extraer `EventualityProviderInvoiceService` (`extractProviderInvoice`, `addProviderInvoice`) en `src/eventualities/services/eventuality-provider-invoice.service.ts` (≤120 líneas).
- [ ] **2.3**: Delegar ambos dominios en `EventualitiesService` y verificar pruebas existentes.

### Fase 3: Conciliación de Consumos y Tasas (`Consumption`)
- [ ] **3.1**: Extraer `EventualityConsumptionService` (`processConsumptionFile`, `getExtractionDetails`, `updateExtractionDetails`, `recalculateConsumptionByDate`, `getConsumptionAlertConfig`, `updateConsumptionAlertConfig`) en `src/eventualities/services/eventuality-consumption.service.ts` (≤260 líneas) apoyándose en `eventuality-consumption.helper.ts`.
- [ ] **3.2**: Delegar métodos en `EventualitiesService` y crear `eventuality-consumption.service.spec.ts`.

### Fase 4: Cola Médica y Atención APS (`DoctorConsultation` & `General`)
- [ ] **4.1**: Extraer `EventualityDoctorConsultationService` (`getDoctorDashboardStats`, `getDoctorQueue`, `claimPatient`, `saveApsConsultation`) en `src/eventualities/services/eventuality-doctor-consultation.service.ts` (≤230 líneas).
- [ ] **4.2**: Extraer `EventualityGeneralService` (`createAps`, `createFromRequests`, `createGeneralEventuality`) en `src/eventualities/services/eventuality-general.service.ts` (≤220 líneas).
- [ ] **4.3**: Delegar en `EventualitiesService` y crear sus pruebas unitarias.

### Fase 5: Ciclo de Vida de Emergencias y Fachada Final (`Emergency` & `Facade`)
- [ ] **5.1**: Extraer `EventualityEmergencyService` (`createEmergency`, `approveEmergency`, `rejectEmergency`, `finalizeEmergency`) en `src/eventualities/services/eventuality-emergency.service.ts` (≤260 líneas).
- [ ] **5.2**: Limpiar `EventualitiesService` para que quede exclusivamente como una **Fachada de delegación pura** (`<120 líneas`), eliminando todas las inyecciones de repositorios directos que ya fueron trasladadas a los sub-servicios.

### Fase 6: Segregación de Controladores y Validación de API REST
- [ ] **6.1**: Crear `FindDoctorQueueDto` extendiendo `PaginationQueryDto` para eliminar el `parseInt` manual en `getDoctorQueue`.
- [ ] **6.2**: Dividir `EventualitiesController` (372 líneas) en:
  - `EventualitiesController` (~140 líneas)
  - `EventualityDoctorController` (~90 líneas)
  - `EventualityDocumentController` (~120 líneas, agregando `ParseUUIDPipe` a todos los endpoints PDF)
  - `EventualityBillingController` (~110 líneas)
- [ ] **6.3**: Registrar todos los nuevos controladores y sub-servicios en `EventualitiesModule`.

### Fase 7: Verificación Integral (`/code-review-excellence`)
- [ ] **7.1**: Ejecutar `npm run audit:lines` y comprobar que `eventualities.service.ts` y todos los nuevos archivos de `src/eventualities/` estén por debajo de las 300 líneas.
- [ ] **7.2**: Ejecutar `npm run check-types`, `npm run test` y `npm run build` asegurando 0 errores y 100% de tests en verde.
