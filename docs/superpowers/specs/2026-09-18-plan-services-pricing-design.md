# Especificación de Diseño: Gestión de Costos, Precios de Venta y Factor de Ganancia en Servicios y Planes

- **Fecha:** 2026-09-18
- **Estado:** Aprobado
- **Módulos Involucrados:** `SystemSettingsModule`, `PlansModule` (`MedicalServices`, `PlanServices`, `Plans`)

---

## 1. Resumen Ejecutivo

Esta especificación detalla la incorporación de costos base, precios de venta y factor de ganancia en el ecosistema de servicios médicos y planes de salud de SIS-SIRCA. 

Permite que:
1. Cada servicio médico en el catálogo (`MedicalService`) defina su costo base y un precio de venta opcional.
2. Cada servicio asociado a un plan (`PlanService`) pueda heredar estos valores dinámicamente o sobreescribirlos de manera independiente para ese plan.
3. Si un servicio en un plan no tiene un precio de venta asignado (ni en el plan ni en el catálogo), el sistema calcula automáticamente un precio de venta efectivo multiplicando el costo por un factor de ganancia.
4. El factor de ganancia puede definirse a nivel del plan (`profitFactor`) o tomar el factor global del sistema (`DEFAULT_SERVICE_PRICE_FACTOR`), el cual es administrable dinámicamente en base de datos por usuarios con permisos especiales (`manage:system-settings`).

---

## 2. Modelo de Datos y Esquema de Base de Datos

### 2.1. Entidad `SystemSetting` (`system_settings`)
Almacena parámetros de configuración global del sistema dinámicamente editables por administradores autorizados.

```typescript
@Entity('system_settings')
export class SystemSetting {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
```

* **Semilla inicial:**
  * `key`: `'DEFAULT_SERVICE_PRICE_FACTOR'`
  * `value`: `'2.00'`
  * `description`: `'Factor multiplicador global por defecto para calcular el precio de venta de servicios a partir del costo'`
* **Permisos del sistema:**
  * `read:system-settings`: Permiso para consultar configuraciones del sistema.
  * `manage:system-settings`: Permiso para crear y modificar configuraciones del sistema.
  * Asignados inicialmente al rol `admin`.

### 2.2. Modificaciones en `MedicalService` (`medical_services`)
* `cost`: `numeric(10, 2) NOT NULL DEFAULT 0.00`
  * Constraint: `CHK_medical_services_cost` (`"cost" >= 0`)
* `sale_price`: `numeric(10, 2) NULL`
  * Constraint: `CHK_medical_services_sale_price` (`"sale_price" IS NULL OR "sale_price" >= 0`)

### 2.3. Modificaciones en `Plan` (`plans`)
* `profit_factor`: `numeric(5, 2) NULL`
  * Constraint: `CHK_plans_profit_factor` (`"profit_factor" IS NULL OR "profit_factor" > 0`)
* *Nota:* `amount` se mantiene como la cuota mensual del plan establecida manualmente por el usuario.

### 2.4. Modificaciones en `PlanService` (`plan_services`)
* `cost`: `numeric(10, 2) NULL`
  * Constraint: `CHK_plan_services_cost` (`"cost" IS NULL OR "cost" >= 0`)
  * Si es `NULL`, hereda dinámicamente el costo de `medical_services.cost`.
* `sale_price`: `numeric(10, 2) NULL`
  * Constraint: `CHK_plan_services_sale_price` (`"sale_price" IS NULL OR "sale_price" >= 0`)
  * Si es `NULL`, se resuelve dinámicamente mediante la cascada de precios.

---

## 3. Lógica de Cascada de Precios y Resolución Dinámica

Al consultar un servicio de un plan (`PlanService`), el backend calcula los valores efectivos en tiempo de ejecución:

### 3.1. Costo Efectivo (`effectiveCost`)
$$\text{effectiveCost} = \begin{cases} \text{planService.cost}, & \text{si } \text{planService.cost} \neq \text{null} \\ \text{medicalService.cost}, & \text{en caso contrario} \end{cases}$$

### 3.2. Factor Efectivo (`effectiveFactor`)
$$\text{effectiveFactor} = \begin{cases} \text{plan.profitFactor}, & \text{si } \text{plan.profitFactor} \neq \text{null} \\ \text{globalFactor (de system\_settings)}, & \text{en caso contrario} \end{cases}$$

### 3.3. Precio de Venta Efectivo (`effectiveSalePrice`)
$$\text{effectiveSalePrice} = \begin{cases} 
\text{planService.salePrice}, & \text{si } \text{planService.salePrice} \neq \text{null} \\
\text{medicalService.salePrice}, & \text{si } \text{medicalService.salePrice} \neq \text{null} \\
\text{round}(\text{effectiveCost} \times \text{effectiveFactor}, 2), & \text{en caso contrario}
\end{cases}$$

### 3.4. Flags de Metadatos
* `isCostOverridden`: `planService.cost !== null && planService.cost !== undefined`
* `isPriceOverridden`: `planService.salePrice !== null && planService.salePrice !== undefined`

---

## 4. Arquitectura y Endpoints

### 4.1. Módulo `SystemSettingsModule` (`src/system-settings/`)
* **Controlador:** `SystemSettingsController` (`/system-settings`)
  * `GET /system-settings`: Lista configuraciones. Requiere `read:system-settings` o `manage:system-settings`.
  * `GET /system-settings/:key`: Obtiene una configuración específica.
  * `PATCH /system-settings/:key`: Actualiza el valor de una clave (`{ value: string }`). Requiere `manage:system-settings`.
* **Servicio:** `SystemSettingsService`:
  * Métodos `get(key: string, defaultValue?: string): Promise<string>`.
  * `getNumeric(key: string, defaultValue?: number): Promise<number>`.
  * `set(key: string, value: string): Promise<SystemSetting>`.
  * Mantiene una caché en memoria de lectura rápida con invalidación al actualizar.

### 4.2. Módulo de Planes (`src/plans/`)
* **MedicalServices:**
  * `CreateMedicalServiceDto` y `UpdateMedicalServiceDto`:
    * `cost`: `@IsNumber()` `@Min(0)`
    * `salePrice`: `@IsOptional()` `@IsNumber()` `@Min(0)`
* **Plans:**
  * `CreatePlanDto` y `UpdatePlanDto`:
    * `profitFactor`: `@IsOptional()` `@IsNumber()` `@Min(0.01)`
* **PlanServices:**
  * `CreatePlanServiceDto`, `UpdatePlanServiceDto`, y `BatchCreatePlanServicesDto`:
    * `cost`: `@IsOptional()` `@IsNumber()` `@Min(0)`
    * `salePrice`: `@IsOptional()` `@IsNumber()` `@Min(0)`
  * `PlanServicesService`:
    * Al agregar/actualizar/clonar servicios, maneja los campos `cost` y `salePrice`.
    * Al consultar (`findByPlan`, `findOne`), adjunta `effectiveCost` (como `cost`), `effectiveSalePrice` (como `salePrice`), `isCostOverridden`, `isPriceOverridden`, y el `profitFactor` del plan.

---

## 5. Estrategia de Migración de Base de Datos

Se creará una nueva migración que:
1. Cree la tabla `system_settings`.
2. Inserte el parámetro `DEFAULT_SERVICE_PRICE_FACTOR = '2.00'`.
3. Inserte los permisos `read:system-settings` y `manage:system-settings` y los vincule al rol `admin`.
4. Agregue las columnas `cost` y `sale_price` a `medical_services`.
5. Agregue la columna `profit_factor` a `plans`.
6. Agregue las columnas `cost` y `sale_price` a `plan_services`.
7. Cree las restricciones `CHECK` correspondientes.
8. Implemente el método `down` para reversión limpia.

---

## 6. Plan de Pruebas y Validación
* **Pruebas Unitarias:**
  * `SystemSettingsService`: recuperación con fallback, actualización e invalidación de caché.
  * `MedicalServicesService`: validación de costos y precios base.
  * `PlanServicesService`: verificación de la cascada de precios en los 3 escenarios (sobreescrito en plan, tomado de catálogo, calculado por factor del plan, calculado por factor global).
  * `PlanCloningService`: verificación de que los overrides de costo y precio se preservan al clonar entre planes.
* **Pruebas de Integración/E2E:**
  * Endpoints `/system-settings` con control de acceso por permisos.
  * Endpoints `/plans/:id/services` con verificación de respuestas agrupadas y planas.
