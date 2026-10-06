# Especificación de Diseño: Reporte de Afiliaciones y Desafiliaciones

- **Fecha:** 2026-10-06
- **Estado:** Aprobado
- **Módulos afectados:** 
  - Backend: `sis-sirca` (`src/reports`, `src/pdf`)
  - Frontend: `sirca-front-app` (`components/dashboard/reports`)

---

## 1. Visión General y Objetivos

El sistema SIRCA requiere un nuevo reporte operativo y gerencial que permita auditar y visualizar las **afiliaciones y desafiliaciones** registradas en el sistema dentro de un rango de fechas flexible (`startDate` y `endDate`).

El reporte debe generarse tanto en formato **Excel (.xlsx)** como en **PDF**, y estar disponible en el centro de reportes de la aplicación web frontend (`sirca-front-app`).

### Requisitos Clave:
1. **Filtro de fechas:** Parámetros obligatorios `startDate` y `endDate` en formato ISO `YYYY-MM-DD`. La consulta cubre desde `00:00:00.000` del `startDate` hasta las `23:59:59.999` del `endDate` en la zona horaria de Caracas (`America/Caracas`).
2. **Estructura Excel:** Archivo con 2 pestañas separadas:
   - Pestaña **"Afiliaciones"**
   - Pestaña **"Desafiliaciones"**
3. **Estructura PDF:** Documento con membrete institucional, tarjetas métricas de totales y dos secciones/tablas consecutivas:
   - Sección **Afiliaciones**
   - Sección **Desafiliaciones**
4. **Campos mínimos por movimiento:**
   - **Afiliación:** N° Contrato, Cédula de Identidad, Nombre del Afiliado, Plan, Fecha de Afiliación.
   - **Desafiliación:** N° Contrato, Cédula de Identidad, Nombre del Desafiliado, Plan, Fecha de Desafiliación, Motivo / Razón de Desafiliación.
5. **Reglas de negocio:**
   - Excluir movimientos revertidos (`is_reverted = false`).
   - Se obtienen registros de la tabla `affiliation_history` con relaciones a `contract`, `person` y `plan`.
   - Validar que `startDate <= endDate`.
6. **Frontend:** Integrar la nueva opción de reporte en `ReportsPanel.tsx` con selectores `DatePicker` para fecha inicial y final, y botones para descargar en Excel y PDF.

---

## 2. Arquitectura Backend (NestJS - `sis-sirca`)

### 2.1. DTO de Parámetros (`src/reports/dto/affiliations-report-query.dto.ts`)
```typescript
import { IsDateString, IsNotEmpty } from 'class-validator';

export class AffiliationsReportQueryDto {
  @IsNotEmpty({ message: 'La fecha inicial (startDate) es requerida.' })
  @IsDateString({}, { message: 'La fecha inicial (startDate) debe tener un formato válido YYYY-MM-DD.' })
  startDate: string;

  @IsNotEmpty({ message: 'La fecha final (endDate) es requerida.' })
  @IsDateString({}, { message: 'La fecha final (endDate) debe tener un formato válido YYYY-MM-DD.' })
  endDate: string;
}
```

### 2.2. Modelo de Datos y Tipos Internos
```typescript
export interface AffiliationItem {
  contractCode: string;
  identityCard: string;
  fullName: string;
  planName: string;
  actionDateFormatted: string; // DD/MM/YYYY
  actionDateRaw: Date;
}

export interface DisaffiliationItem extends AffiliationItem {
  reason: string;
}

export interface AffiliationsReportData {
  startDate: string;
  endDate: string;
  startDateFormatted: string;
  endDateFormatted: string;
  generatedAt: string;
  totalAffiliations: number;
  totalDisaffiliations: number;
  affiliations: AffiliationItem[];
  disaffiliations: DisaffiliationItem[];
  logoBase64?: string;
}
```

### 2.3. Servicio `AffiliationsReportService` (`src/reports/affiliations-report.service.ts`)
* **Dependencias inyectadas:**
  - `@InjectRepository(AffiliationHistory) private readonly historyRepo: Repository<AffiliationHistory>`
  - `private readonly pdfService: PdfService`
* **Métodos principales:**
  - `getReportData(startDate: string, endDate: string): Promise<AffiliationsReportData>`:
    - Valida que `startDate <= endDate` usando Luxon DateTime en zona `America/Caracas`.
    - Construye `startDateTime` a las `00:00:00.000` y `endDateTime` a las `23:59:59.999`.
    - Consulta `AffiliationHistory` con relaciones `['contract', 'person', 'plan']`.
    - Filtra por `action_date BETWEEN :start AND :end` y `is_reverted = false`.
    - Ordena cronológicamente descendente (`action_date DESC`).
    - Clasifica en listas `affiliations` y `disaffiliations`.
  - `generateExcel(startDate: string, endDate: string): Promise<Buffer>`:
    - Crea el `Workbook` con `exceljs`.
    - Agrega hoja 1: `Afiliaciones`. Inserta título, período, tarjeta resumen con total, encabezados de columnas con estilo corporativo verde (`#1d9e11`) y bordes.
    - Agrega hoja 2: `Desafiliaciones`. Inserta título, período, tarjeta resumen con total, encabezados de columnas (incluyendo "Motivo de Desafiliación") y filas con autofit.
    - Retorna el buffer del libro de Excel.
  - `generatePdf(startDate: string, endDate: string): Promise<Buffer>`:
    - Carga datos con `getReportData()`.
    - Carga el logo corporativo con `loadLogoBase64()`.
    - Invoca `pdfService.generatePdfFromTemplate('affiliations-report', data)`.

### 2.4. Plantilla Handlebars (`src/pdf/templates/affiliations-report.hbs`)
* **Diseño visual:**
  - Colores corporativos SIRCA: Primario `#1d9e11`, bordes `#e2e8f0`, texto `#333333`.
  - Cabecera con logo, título "Reporte de Afiliaciones y Desafiliaciones", período y fecha/hora de generación.
  - Tarjetas de resumen métrico:
    - Tarjeta 1: Total Afiliaciones (verde).
    - Tarjeta 2: Total Desafiliaciones (rojo/ámbar suave).
  - Sección 1: Tabla de Afiliaciones (5 columnas).
  - Sección 2: Tabla de Desafiliaciones (6 columnas: incluye columna "Motivo").
  - Si no hay registros en alguna sección, renderiza un bloque de aviso centrado con borde suave.

### 2.5. Controlador `ReportsController` (`src/reports/reports.controller.ts`)
* Endpoints agregados:
  ```typescript
  @Get('affiliations/excel')
  @RequirePermissions('read:reports')
  async downloadAffiliationsExcel(
    @Query() query: AffiliationsReportQueryDto,
    @Res() res: Response,
  ): Promise<void>
  ```
  ```typescript
  @Get('affiliations/pdf')
  @RequirePermissions('read:reports')
  async downloadAffiliationsPdf(
    @Query() query: AffiliationsReportQueryDto,
    @Res() res: Response,
  ): Promise<void>
  ```
* Headers de respuesta HTTP:
  - Excel: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="reporte-afiliaciones-desafiliaciones-${startDate}-a-${endDate}.xlsx"`
  - PDF: `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="reporte-afiliaciones-desafiliaciones-${startDate}-a-${endDate}.pdf"`

### 2.6. Módulo `ReportsModule` (`src/reports/reports.module.ts`)
* Importar `TypeOrmModule.forFeature([AffiliationHistory])`.
* Registrar `AffiliationsReportService` en `providers` y `exports`.

---

## 3. Arquitectura Frontend (Next.js - `sirca-front-app`)

### 3.1. Modificación de `ReportsPanel.tsx`
* **Definición de reporte agregada en `REPORTS`:**
  ```typescript
  {
    id: 'affiliations-disaffiliations',
    title: 'Afiliaciones y Desafiliaciones',
    shortDesc: 'Movimientos de afiliados por fecha.',
    longDesc: 'Reporte consolidado de afiliaciones y desafiliaciones ocurridas dentro de un rango de fechas. Muestra para cada desafiliación la razón, nombre, cédula, contrato y fecha; y para cada afiliación el nombre, cédula, contrato y fecha.',
    icon: Users,
    active: true,
    badge: 'Disponible',
    badgeColor: '#16a34a',
  }
  ```
* **Estado de fechas:**
  - `startDate`: string inicializado en el primer día del mes actual (`YYYY-MM-01`).
  - `endDate`: string inicializado en el día actual (`getTodayString()`).
* **Filtros en el panel:**
  - Cuando `selectedReportId === 'affiliations-disaffiliations'`, ocultar selectores de Año/Mes y mostrar una fila con dos componentes `DatePicker`:
    1. "Fecha Inicial" (`startDate`).
    2. "Fecha Final" (`endDate`).
* **Manejo de descarga (`handleDownload`):**
  - Validación antes de la petición: comprobar que `startDate <= endDate`. Si no, mostrar error: *"La fecha inicial no puede ser posterior a la fecha final."*
  - Si es válido, ejecutar `fetch` a `/reports/affiliations/${format}?startDate=${startDate}&endDate=${endDate}`.
  - Descargar archivo con nombre: `reporte-afiliaciones-desafiliaciones-${startDate}-a-${endDate}.${format === 'excel' ? 'xlsx' : 'pdf'}`.

---

## 4. Plan de Pruebas y Validación

1. **Pruebas Unitarias Backend (`affiliations-report.service.spec.ts`):**
   - Validación de rango de fechas: rechazar `startDate > endDate`.
   - Consulta a `AffiliationHistory`: verificar filtros `is_reverted = false`, acciones correctas y relaciones.
   - Generación de Excel: comprobar que genera buffer no vacío y con las dos hojas ('Afiliaciones' y 'Desafiliaciones').
   - Generación de PDF: comprobar invocación adecuada a `PdfService`.
2. **Pruebas del Controlador (`reports.controller.spec.ts`):**
   - Verificar endpoints `downloadAffiliationsExcel` y `downloadAffiliationsPdf` con parámetros válidos e inválidos.
3. **Pruebas Frontend:**
   - Verificar que al seleccionar el reporte se muestren los DatePickers correspondientes.
   - Verificar que la validación de rango impida descargas inconsistentes.
4. **Verificación de Tipos y Linter:**
   - Ejecutar `pnpm check-types` y `pnpm lint` en ambos proyectos.
