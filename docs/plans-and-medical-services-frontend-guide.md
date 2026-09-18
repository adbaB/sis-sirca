# Guía de Integración Frontend: Planes y Servicios Médicos (SIS-SIRCA)

Esta guía documenta la estructura, reglas de negocio, endpoints y flujos de interfaz requeridos para implementar el módulo de **Planes de Salud y Catálogo de Servicios Médicos** en el Frontend.

---

## 1. Arquitectura y Modelo de Datos

El módulo se compone de 4 entidades principales jerarquizadas:

```
┌────────────────────────────────────────────────────────┐
│                   ServiceCategory                      │
│       (Categoría médica: ej. Consultas, Odontología)   │
└──────────────────────────┬─────────────────────────────┘
                           │ 1 a N
                           ▼
┌────────────────────────────────────────────────────────┐
│                   MedicalService                       │
│        (Catálogo de servicios: ej. Consulta General)   │
│   * Vinculado con antecedentes de salud (HealthCategory)│
└──────────────────────────┬─────────────────────────────┘
                           │ N a M mediante PlanService
                           ▼
┌──────────────────────────┴─────────────────────────────┐
│                     PlanService                        │
│       Configuración de Cobertura en el Plan:          │
│       - Tipo de límite (UNLIMITED, MONTHLY, ANNUAL)    │
│       - Cantidad límite                                │
│       - Días de carencia (waiting_period_days)         │
│       - Copago fijo ($) y/o Porcentaje (%)             │
└──────────────────────────┬─────────────────────────────┘
                           │ N a 1
                           ▼
┌────────────────────────────────────────────────────────┐
│                        Plan                            │
│     (Plan de salud: nombre, edades, cuota, cobertura)  │
└────────────────────────────────────────────────────────┘
```

---

## 2. Enumeraciones y Tipos Clave

### Estado del Plan (`PlanStatus`)
```typescript
export enum PlanStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}
```

### Tipo de Límite de Servicio (`PlanServiceLimitType`)
```typescript
export enum PlanServiceLimitType {
  UNLIMITED = 'UNLIMITED', // Sin límite de usos
  MONTHLY = 'MONTHLY',     // Límite por mes calendario
  ANNUAL = 'ANNUAL',       // Límite por año
}
```

### Categorías de Salud / Antecedentes (`HealthCategory`)
Utilizadas en `MedicalService.linkedHealthCategories` para sugerir exclusiones automáticas cuando el afiliado declara patologías preexistentes:
```typescript
export enum HealthCategory {
  CARDIOVASCULAR = 'CARDIOVASCULAR',
  RESPIRATORIA = 'RESPIRATORIA',
  DIGESTIVA = 'DIGESTIVA',
  ENDOCRINA = 'ENDOCRINA',
  OSTEOMUSCULAR = 'OSTEOMUSCULAR',
  GENITOURINARIA = 'GENITOURINARIA',
  PIEL_OJOS_OIDOS = 'PIEL_OJOS_OIDOS',
  CRONICA_TRANSITORIA = 'CRONICA_TRANSITORIA',
  GINECOLOGICA = 'GINECOLOGICA',
  QUIRURGICA = 'QUIRURGICA',
  OTROS = 'OTROS',
}
```

---

## 3. Reglas de Negocio y Validaciones

### 3.1. Reglas de Planes (`Plan`)
1. **Rango de Edad**:
   - `minAge` >= 0 (por defecto 0).
   - `maxAge` >= `minAge`.
   - Ambos son números enteros.
2. **Permanencia Mínima**:
   - `minMonths` >= 2 (por defecto 2 meses).
3. **Montos Financieros**:
   - `amount`: Precio/cuota del plan (número > 0).
   - `commissionAmount`: Comisión para el asesor (>= 0).
   - `coverage`: Monto global de cobertura máxima en dinero (>= 0).
4. **Estado**:
   - Solo puede ser `ACTIVE` o `INACTIVE`.
5. **Borrado**:
   - Implementa **Soft-Delete** (no borra físicamente la fila).

---

### 3.2. Reglas de Categorías (`ServiceCategory`)
1. **Código Único**: El `code` no puede duplicarse entre categorías activas.
2. **Protección de Integridad**: No se puede eliminar una categoría si tiene servicios médicos asociados (retorna `400 InvalidDomainOperationException`).

---

### 3.3. Reglas de Servicios Médicos (`MedicalService`)
1. **Código Único**: El `code` no puede repetirse entre servicios activos.
2. **Categoría Obligatoria**: Debe pertenecer a una categoría existente (`categoryId`).
3. **Categorías de Salud Vinculadas**: Campo array `linkedHealthCategories` con valores del enum `HealthCategory`. Se usa para relacionar patologías declaradas con servicios que deberían excluirse en las afiliaciones.
4. **Protección de Integridad**: No se puede eliminar un servicio médico si está asignado a planes activos.

---

### 3.4. Reglas de Configuración de Servicios en el Plan (`PlanService`)
1. **Unicidad en el Plan**: Un mismo servicio médico **solo puede agregarse una vez** a un plan determinado. Intentar agregar un servicio ya existente arroja `409 EntityAlreadyExistsException`.
2. **Regla Estricta de Límites**:
   - Si `limitType === 'UNLIMITED'`: El campo `limitQuantity` **DEBE ser `null`**. (El backend lanza error si se envía un número).
   - Si `limitType === 'MONTHLY'` o `'ANNUAL'`: El campo `limitQuantity` **es obligatorio y debe ser un número entero >= 1**.
3. **Período de Carencia (`waitingPeriodDays`)**:
   - Número de días enteros transcurridos desde la fecha de afiliación del contrato para que el servicio entre en cobertura (>= 0).
4. **Copagos**:
   - `copayAmount`: Monto fijo en divisa por uso del servicio (>= 0).
   - `copayPercentage`: Porcentaje de copago entre `0` y `100`.

---

## 4. Endpoints y Especificación de la API

### 4.1. Planes (`/plans`)

| Método | Endpoint | Permiso requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/plans` | `create:plans` | Crear un nuevo plan |
| `GET` | `/plans` | `read:plans` o `create:contracts` | Listar todos los planes (ordena por nombre DESC) |
| `GET` | `/plans/:id` | `read:plans` o `create:contracts` | Obtener detalle de un plan |
| `PATCH` | `/plans/:id` | `update:plans` | Modificar un plan |
| `DELETE`| `/plans/:id` | `delete:plans` | Eliminación lógica (soft-delete) |

#### Payload Crear Plan (`POST /plans`):
```json
{
  "name": "Plan Familiar Platino",
  "minAge": 0,
  "maxAge": 65,
  "amount": 25.00,
  "commissionAmount": 5.00,
  "coverage": 10000.00,
  "minMonths": 3,
  "status": "ACTIVE"
}
```

---

### 4.2. Categorías de Servicios (`/plans/categories`)

| Método | Endpoint | Permiso requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/plans/categories` | `create:plans` | Crear categoría |
| `GET` | `/plans/categories` | `read:plans` o `create:contracts` | Listar categorías (orden ASC) |
| `GET` | `/plans/categories/:id` | `read:plans` o `create:contracts` | Detalle categoría |
| `PATCH` | `/plans/categories/:id` | `update:plans` | Modificar categoría |
| `DELETE`| `/plans/categories/:id` | `delete:plans` | Eliminar categoría (valida sin servicios) |

#### Payload Crear Categoría (`POST /plans/categories`):
```json
{
  "code": "CONS_MED",
  "name": "Consultas Médicas",
  "description": "Especialidades y medicina general",
  "isActive": true
}
```

---

### 4.3. Catálogo de Servicios Médicos (`/plans/medical-services`)

| Método | Endpoint | Permiso requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/plans/medical-services` | `create:plans` | Crear servicio en el catálogo |
| `GET` | `/plans/medical-services` | `read:plans` o `create:contracts` | Listar catálogo de servicios (incluye categoría) |
| `GET` | `/plans/medical-services/:id` | `read:plans` o `create:contracts` | Detalle del servicio |
| `PATCH` | `/plans/medical-services/:id` | `update:plans` | Modificar servicio médico |
| `DELETE`| `/plans/medical-services/:id` | `delete:plans` | Eliminar servicio médico |

#### Payload Crear Servicio Médico (`POST /plans/medical-services`):
```json
{
  "code": "CONS_CAR_01",
  "name": "Consulta Cardiología",
  "description": "Evaluación médica por especialista cardiólogo",
  "categoryId": "c0a80124-...",
  "linkedHealthCategories": ["CARDIOVASCULAR"],
  "isActive": true
}
```

---

### 4.4. Cobertura de Servicios en el Plan (`/plans/:id/services`)

| Método | Endpoint | Permiso | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/plans/:id/services?grouped=true` | `read:plans` | Listar servicios del plan (agrupados por categoría o planos) |
| `POST` | `/plans/:id/services` | `update:plans` | Agregar un servicio al plan |
| `POST` | `/plans/:id/services/batch` | `update:plans` | Agregar múltiples servicios en lote |
| `GET` | `/plans/:id/services/:planServiceId` | `read:plans` | Detalle de un servicio en el plan |
| `PATCH` | `/plans/:id/services/:planServiceId` | `update:plans` | Modificar límites, carencia o copago |
| `DELETE`| `/plans/:id/services/:planServiceId` | `update:plans` | Quitar servicio del plan |
| `POST` | `/plans/:id/clone-services-from/:sourcePlanId` | `update:plans` | Clonar servicios desde otro plan |

#### Payload Agregar Servicio Individual (`POST /plans/:id/services`):
```json
{
  "medicalServiceId": "8f8888b5-...",
  "limitType": "ANNUAL",
  "limitQuantity": 12,
  "waitingPeriodDays": 30,
  "copayAmount": 5.00,
  "copayPercentage": 0
}
```
> **Nota para UNLIMITED**:
> Si `limitType: "UNLIMITED"`, omitir `limitQuantity` o enviar `null`.

#### Payload Carga en Lote (`POST /plans/:id/services/batch`):
```json
{
  "services": [
    {
      "medicalServiceId": "8f8888b5-...",
      "limitType": "UNLIMITED",
      "waitingPeriodDays": 0,
      "copayAmount": 0,
      "copayPercentage": 0
    },
    {
      "medicalServiceId": "5a4112e4-...",
      "limitType": "MONTHLY",
      "limitQuantity": 2,
      "waitingPeriodDays": 60,
      "copayAmount": 10.00,
      "copayPercentage": 20
    }
  ]
}
```

#### Respuesta de Clonación (`POST /plans/:id/clone-services-from/:sourcePlanId`):
```json
{
  "targetPlanId": "plan-destino-uuid",
  "sourcePlanId": "plan-origen-uuid",
  "clonedCount": 5,
  "skippedCount": 2,
  "clonedServices": [ /* array de PlanService creados */ ]
}
```

#### Respuesta de Consulta Agrupada (`GET /plans/:id/services?grouped=true`):
```json
[
  {
    "category": {
      "id": "cat-uuid-1",
      "code": "CONS_MED",
      "name": "Consultas Médicas",
      "description": "Especialidades"
    },
    "services": [
      {
        "id": "ps-uuid-1",
        "planId": "plan-uuid",
        "medicalServiceId": "ms-uuid-1",
        "limitType": "ANNUAL",
        "limitQuantity": 6,
        "waitingPeriodDays": 30,
        "copayAmount": "0.00",
        "copayPercentage": "0.00",
        "medicalService": {
          "id": "ms-uuid-1",
          "code": "CONS_PED",
          "name": "Consulta Pediatría"
        }
      }
    ]
  }
]
```

---

## 5. Casos de Uso y Recomendaciones para la Interfaz (UI/UX)

### 1. Pantalla: Catálogo de Servicios y Categorías (Admin)
- **Vista de Categorías**: Tabla simple con botón crear/editar/eliminar. Bloquear borrado con tooltip si tiene servicios vinculados.
- **Vista de Servicios Médicos**:
  - Selector con búsqueda para la `Categoría`.
  - Multi-select o chips con las categorías de salud (`linkedHealthCategories` del enum) para relacionar preexistencias médicas.
  - Indicador de estado (Activo/Inactivo).

### 2. Pantalla: Detalle y Configuración de un Plan
- **Encabezado del Plan**: Tarjeta con nombre, edades (min/max), prima ($), cobertura ($) y permanencia mínima.
- **Acción Rápida "Clonar Cobertura desde otro Plan"**:
  - Modal selector de plan origen.
  - Al ejecutar, notifica: *"Se clonaron X servicios (Y servicios ya existían y fueron omitidos)"*.
- **Listado de Cobertura con `?grouped=true`**:
  - Mostrar como **Acordeón o Secciones por Categoría**.
  - En cada servicio, mostrar badges claros:
    - Límite: `Ilimitado` | `X / Mes` | `X / Año`.
    - Carencia: `Sin carencia` o `X días de espera`.
    - Copago: `$0.00` o `X%`.
- **Modal de Agregar/Editar Servicio**:
  - Selector de Servicio Médico (filtrando los que ya pertenecen al plan).
  - Selector de `limitType`: Si selecciona `UNLIMITED`, deshabilitar y limpiar el input `limitQuantity`. Si selecciona `MONTHLY` o `ANNUAL`, forzar campo requerido con mínimo `1`.
  - Inputs para `waitingPeriodDays`, `copayAmount`, `copayPercentage`.

### 3. Pantalla de Consulta de Beneficios del Afiliado (`GET /persons/:id/benefits`)
Cuando un afiliado acude o consulta sus beneficios, la UI debe mostrar el estado tripartito que calcula el backend:
- `COVERED` (Verde): Cobertura activa y disponible.
- `WAITING_PERIOD` (Amarillo): En período de carencia (mostrar `remainingWaitingPeriodDays` y `effectiveDate`).
- `EXCLUDED` (Rojo): Excluido por patología declarada o decisión del auditor (mostrar `exclusionReason`).
