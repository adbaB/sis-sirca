# Plan de Implementación: Eventualidad de Tipo Consulta (`CONSULTATION`) y Agenda Médica

**Fecha**: 2026-11-08  
**Spec Asociado**: `docs/superpowers/specs/2026-11-08-doctor-schedule-and-consultation-eventuality-design.md`  

---

## Fase 1: Esquema de Base de Datos y Helper Puro de Disponibilidad (`src/doctors`)
1. Crear migración `src/database/migrations/1793300000000-AddDoctorScheduleConfigColumns.ts`.
2. Actualizar `src/doctors/entities/doctor.entity.ts` con las columnas de agenda y `DoctorDaySchedule`.
3. Implementar con TDD `src/doctors/helpers/doctor-availability.helper.ts` y `src/doctors/helpers/doctor-availability.helper.spec.ts`.

## Fase 2: Sub-Servicio de Agenda de Médicos (`src/doctors`)
1. Crear `src/doctors/dto/update-doctor-schedule.dto.ts`.
2. Implementar `src/doctors/services/doctor-schedule.service.ts` y `src/doctors/services/doctor-schedule.service.spec.ts`.
3. Exponer endpoints en `src/doctors/doctors.controller.ts` y registrar en `src/doctors/doctors.module.ts`.

## Fase 3: Sub-Servicio y Controlador de Consultas (`src/eventualities`)
1. Crear `src/eventualities/dto/schedule-consultation.dto.ts`.
2. Implementar `src/eventualities/services/eventuality-consultation.service.ts` y `src/eventualities/services/eventuality-consultation.service.spec.ts`.
3. Crear `src/eventualities/controllers/eventuality-consultation.controller.ts` y registrar en `src/eventualities/eventualities.module.ts`.
4. Habilitar en `EventualitiesService` y `EventualitiesController` la carga/redacción de informe médico y consumo para eventualidades en estado `SCHEDULED` con transición a `WAITING_INVOICE`.

## Fase 4: Frontend (`sirca-front-app`)
1. Actualizar tipos e hooks (`lib/types.ts`, `hooks/useDoctors.ts`, `hooks/useEventualities.ts`).
2. Crear `DoctorScheduleConfigModal.tsx` e integrarlo en `DoctorsManager.tsx`.
3. Crear `DoctorAvailabilityCalendarPicker.tsx` para selección visual de días y turnos disponibles.
4. Crear `ConsultationAssignmentPanel.tsx` e integrarlo como pestaña en `AdvisorPaymentsPanel.tsx` (`/dashboard/pagos-asesores`).
5. Integrar el agendamiento con calendario en `OperativeActionModal.tsx` y `PendingServiceRequestsSection.tsx` (`/dashboard/verificacion`).
6. Crear `DoctorConsultationsCalendarView.tsx` e integrarlo en `DoctorDashboardManager.tsx` (`/dashboard/medico`) con acciones para redactar o subir informe médico pasando a `WAITING_INVOICE`.

## Fase 5: Verificación y Auditoría de Calidad
1. Ejecutar `npm run audit:lines`, `npm run check-types`, `npm run test` y `npm run build` en `sis-sirca`.
2. Ejecutar verificación de tipos y build en `sirca-front-app`.
