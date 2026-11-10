# Plan de Implementación: Permisos de Médico (APS, Citas Asignadas y Médico Auditor)

- **Fecha**: 2026-11-09
- **Spec**: `docs/superpowers/specs/2026-11-09-doctor-permissions-and-medical-auditor-design.md`

---

## Fase 1: Migración de Base de Datos y Entidad `Doctor` (`sis-sirca`)
1. Crear migración `src/database/migrations/1793400000000-AddDoctorPermissionsAndAuditorRole.ts`:
   - Añadir columnas `can_attend_aps`, `can_schedule_consultations`, `is_medical_auditor` a `doctors`.
   - Insertar permisos `attend:aps`, `attend:consultations`, `audit:medical`, `manage:doctors` en `permissions`.
   - Crear/actualizar roles `Medico`, `Medico Consultas`, `Medico Auditor` y asignar permisos en `role_permissions`.
2. Actualizar `src/doctors/entities/doctor.entity.ts`, `src/doctors/dto/create-doctor.dto.ts` y `src/doctors/doctors.service.ts`.

## Fase 2: Reglas de Autorización y Filtrado en Backend (`sis-sirca`)
1. Actualizar `src/doctors/doctors.controller.ts` para proteger rutas de escritura con `@RequirePermissions('manage:doctors', 'create:users', 'update:users')` y soportar filtros `canAttendAps` y `canScheduleConsultations` en `GET /doctors`.
2. Actualizar `src/eventualities/services/eventuality-consultation.service.ts` y `src/eventualities/helpers/consultation-artifacts.helper.ts`:
   - Validar `doctor.canScheduleConsultations` y `!doctor.isMedicalAuditor` al agendar/reprogramar.
   - Restringir `getDoctorConsultationsCalendar` a `user.doctorId` cuando el usuario solo tiene `attend:consultations` (y permitir vista global a `audit:medical`).
3. Actualizar `src/eventualities/controllers/eventuality-consultation.controller.ts` y `src/eventualities/controllers/eventualities.controller.ts` para permitir lectura a `audit:medical` y `attend:consultations`, bloqueando toda escritura a médicos auditores.
4. Añadir pruebas unitarias en Vitest para verificar el aislamiento de citas por médico y el bloqueo de escritura del médico auditor.

## Fase 3: Interfaz de Usuario en Frontend (`sirca-front-app`)
1. Actualizar `lib/types.ts` con `canAttendAps`, `canScheduleConsultations`, `isMedicalAuditor` en `Doctor` y `CreateDoctorPayload`.
2. Actualizar `components/dashboard/Sidebar.tsx` para habilitar el acceso de `attend:consultations` y `audit:medical` a `/dashboard/medico` y de `audit:medical` a `/dashboard/medicos`.
3. Actualizar `components/dashboard/medical/DoctorsManager.tsx`:
   - Añadir switches de permisos en el modal de médico y badges en la tabla.
   - Modo solo lectura cuando el usuario tiene `audit:medical` sin `manage:doctors`.
4. Actualizar `components/dashboard/verification/OperativeActionModal.tsx` y `components/dashboard/medical/DoctorAvailabilityCalendarPicker.tsx` para filtrar médicos según `canAttendAps` y `canScheduleConsultations`.
5. Actualizar `components/dashboard/medical/DoctorDashboardManager.tsx`, `components/dashboard/medical/DoctorConsultationsCalendarView.tsx` y `components/dashboard/medical/ApsConsultationWorkspace.tsx` para soportar:
   - Vista exclusiva de citas propias cuando solo tiene `attend:consultations`.
   - Modo solo lectura integral para `audit:medical` / `isMedicalAuditor`.
