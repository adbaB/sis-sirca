# Especificación de Diseño: Mejoras en Portal Clínico, Eventualidades y Carga de Pagos

- **Fecha:** 2026-10-22
- **Estado:** Aprobado
- **Módulos afectados:** 
  - Frontend: `sirca-front-app` (`components/dashboard/payments`, `components/dashboard/clinic`, `components/dashboard/eventualities`, `hooks/useEventualities.ts`)

---

## 1. Visión General y Objetivos

Esta especificación cubre 5 ajustes requeridos en el frontend `sirca-front-app` para optimizar el flujo de trabajo de la terminal asistencial clínica, el panel de eventualidades y el registro de pagos de asesores:

1. **Corrección en Carga de Comprobantes:** Eliminar el fallback de comprobante placeholder en `AdvisorPaymentsPanel.tsx`, exigiendo que todo pago cuente con una URL válida en S3 generada por el OCR antes de registrarse.
2. **Bandeja de Informes Médicos:** Quitar el botón de agregar o cargar servicios en la fase de informe médico pendiente (`pending_report`).
3. **Pestaña de Espera de Facturas y Casos Liquidados:**
   - Incluir los casos con estado `CLOSED` (liquidados) junto con `WAITING_INVOICE` y `UNDER_ADMIN_REVIEW`.
   - Quitar botones de edición: "Subir Consumo", "Agregar Servicios" y "Editar Informe".
   - Crear un nuevo panel/modal visual en solo lectura (`EventualityReadOnlyModal`) que permita consultar toda la información clínica, consumo y liquidación sin permitir modificaciones ni salir de la bandeja.
4. **Gráfica del Panel de Eventualidades:** Iniciar la gráfica diaria de eventualidades colapsada (`showChart: false`) por defecto.
5. **Precios de Servicios del Catálogo SIRCA:** Bloquear la edición del precio al agregar un servicio del catálogo SIRCA, permitiendo su modificación únicamente a usuarios con permisos de gestión (`manage:eventualities` o `review:eventuality-consumption`).

---

## 2. Detalle de Cambios por Componente

### 2.1. AdvisorPaymentsPanel: Eliminación de Placeholders de Comprobante
- **Archivo:** `components/dashboard/payments/AdvisorPaymentsPanel.tsx`
- **Problema:** El componente usaba URLs de respaldo ficticias (`placeholder-comprobante.pdf` o timestamp en S3) si `analyzeReceipt` no devolvía `url`, permitiendo registrar pagos sin archivo real en S3.
- **Solución:**
  - Al ejecutar `analyzeReceipt(selectedFile)`:
    - Si `ocrData.url` existe, se asigna `setUploadedUrl(ocrData.url)`.
    - Si no existe `ocrData.url`, se limpia `setUploadedUrl('')`. Se elimina el string sintético `https://sirca-payment-receipts.s3.amazonaws.com/${Date.now()}-${selectedFile.name}`.
  - En `handleSubmitPayment`:
    - Eliminar el fallback `'https://sirca-payment-receipts.s3.amazonaws.com/placeholder-comprobante.pdf'`.
    - Validar explícitamente:
      ```typescript
      if (!uploadedUrl || !uploadedUrl.trim()) {
        setLocalError('Debe adjuntar un comprobante de pago válido y procesado por el sistema antes de registrar el pago.');
        return;
      }
      ```
    - Asignar `url: uploadedUrl.trim()` en el payload.

---

### 2.2. Bandeja Clínica: Quitar Carga de Servicios en Informes Pendientes
- **Archivo:** `components/dashboard/clinic/PendingReportsTable.tsx`
- **Problema:** En la pestaña `"1. Pendientes por Informe Médico"` se mostraba un botón secundario `"Servicios"` que permitía saltar a la pantalla de consumo cuando el caso aún no tenía informe consignado.
- **Solución:**
  - En la rama `item.status === 'CLINIC_PROCESS'`:
    - Eliminar el botón `<Button onClick={() => onOpenManage(item, 'consumption')}><PackagePlus ... /> Servicios</Button>`.
    - Mantener únicamente:
      - Botón `Printer` (imprimir comprobante de siniestro).
      - Botón `Adjuntar Informe` (`onOpenUpload(item)`).
  - En `ClinicNavTabs.tsx` y encabezados de `app/dashboard/clinica/bandeja/page.tsx`, ajustar títulos y descripciones para reflejar claramente la división de fases.

---

### 2.3. Pestaña de Espera de Facturas: Liquidados y Panel Solo Lectura
- **Archivos:**
  - `hooks/useEventualities.ts`
  - `components/dashboard/clinic/PendingReportsTable.tsx`
  - `components/dashboard/clinic/EventualityReadOnlyModal.tsx` (Nuevo)
  - `app/dashboard/clinica/bandeja/page.tsx`

#### A. Consulta de Casos en Espera y Liquidados (`useEventualities.ts`)
- En `fetchPendingReports()`:
  - Añadir consulta para `status=CLOSED&limit=50`:
    ```typescript
    const [pendingRes, waitingRes, reviewRes, closedRes] = await Promise.all([
      api.get<PaginationResponse<Eventuality>>('/eventualities?status=CLINIC_PROCESS&limit=50').catch(() => null),
      api.get<PaginationResponse<Eventuality>>('/eventualities?status=WAITING_INVOICE&limit=50').catch(() => null),
      api.get<PaginationResponse<Eventuality>>('/eventualities?status=UNDER_ADMIN_REVIEW&limit=50').catch(() => null),
      api.get<PaginationResponse<Eventuality>>('/eventualities?status=CLOSED&limit=50').catch(() => null),
    ]);
    const waitingList = [
      ...(waitingRes?.data || []),
      ...(reviewRes?.data || []),
      ...(closedRes?.data || []),
    ];
    setWaitingInvoiceReports(waitingList);
    ```

#### B. Pestaña y Acciones en `PendingReportsTable.tsx`
- Cambiar la etiqueta del tab 2 a: `"2. En Espera de Factura y Liquidados"`.
- Badge de estado: Asegurar que `CLOSED` muestre `<Badge color="#16a34a">Liquidado</Badge>`.
- En la fila de acciones para la pestaña 2 (`phaseView === 'waiting_invoice'`):
  - Eliminar los botones `"Editar Informe"`, `"Subir Consumo"` y `"Agregar Servicios"`.
  - Mantener únicamente:
    - Botón `Printer` (`onOpenVoucher(item)`).
    - Botón `"Ver Detalle"` (`Eye`) que llama a `onOpenReadOnlyDetail(item)` (o `onOpenView(item)`).

#### C. Componente `EventualityReadOnlyModal.tsx`
- Modal/Drawer flotante de visualización completa:
  - **Cabecera:** N° de Siniestro, Paciente, Cédula, Clínica, Fecha de Ingreso y Badge de Estado.
  - **Sección Informe Médico:** Fecha de emisión, diagnóstico presuntivo/definitivo, médico tratante y botón para previsualizar/descargar el archivo PDF del informe consignado.
  - **Sección Consumo y Servicios:** Listado de medicamentos, materiales y servicios con cantidad, costo unitario, total, moneda y factor de cobertura aplicado. Total general de consumo.
  - **Sección Facturas y Liquidación:** Detalle de facturas del proveedor registradas (número de control, monto, fecha) y fecha de liquidación/cierre en caso de estar liquidado.
  - **Sin controles de edición:** Todos los datos se muestran de forma puramente textual y tabular, sin inputs editables ni botones de acción mutable.

---

### 2.4. EventualitiesManager: Gráfica Diaria Oculta por Defecto
- **Archivo:** `components/dashboard/eventualities/EventualitiesManager.tsx`
- **Cambio:**
  - Modificar el estado inicial de `showChart`:
    ```typescript
    const [showChart, setShowChart] = useState(false);
    ```
  - El botón superior mantiene la interactividad alternando entre *"Ver Gráfica Diaria"* y *"Ocultar Gráfica"*.

---

### 2.5. EventualityDetailsPage y EventualityDetailModal: Bloqueo de Precio de Servicios SIRCA
- **Archivos:**
  - `components/dashboard/eventualities/EventualityDetailsPage.tsx`
  - `components/dashboard/eventualities/EventualityDetailModal.tsx`
- **Regla de Negocio:**
  - Al seleccionar un servicio médico del catálogo SIRCA, el costo unitario se fija automáticamente al valor configurado en el catálogo (`found.cost`).
  - La edición de este campo está restringida:
    - Se verifica si el usuario actual posee los permisos:
      ```typescript
      const { canAny } = usePermissions();
      const canEditCatalogServicePrice = canAny(['manage:eventualities', 'review:eventuality-consumption']);
      ```
    - En el input `Costo Unitario ($)` de la tarjeta *"Agregar Servicio del Catálogo SIRCA"*:
      - Si `!canEditCatalogServicePrice`, el input tiene `disabled={true}`, fondo gris atenuado, cursor `not-allowed`, y un texto de ayuda: *"Precio oficial fijado por catálogo SIRCA"*.
      - Si `canEditCatalogServicePrice`, el input permanece editable.
    - En la tabla de renglones (`extractionRows`):
      - Para renglones de categoría `'SERVICIO'` provenientes del catálogo SIRCA, el costo unitario no es editable por usuarios sin el permiso `canEditCatalogServicePrice`.

---

## 3. Plan de Pruebas y Validación

1. **AdvisorPaymentsPanel:**
   - Intentar registrar un pago sin subir comprobante -> debe arrojar mensaje de error y bloquear el envío.
   - Subir comprobante -> verificar que `uploadedUrl` contenga la URL retornada por el OCR en S3 sin texto de placeholder.
2. **PendingReportsTable:**
   - Pestaña 1: Verificar que no exista el botón "Servicios".
   - Pestaña 2: Verificar que se listen casos en `WAITING_INVOICE`, `UNDER_ADMIN_REVIEW` y `CLOSED`.
   - Pestaña 2: Verificar que no existan botones para subir consumo, agregar servicios ni editar informe.
   - Pestaña 2: Clic en "Ver Detalle" abre `EventualityReadOnlyModal` con la información visual correcta sin opciones de edición.
3. **EventualitiesManager:**
   - Cargar `/dashboard/eventualidades` -> comprobar que la gráfica inicie oculta y que el botón muestre *"Ver Gráfica Diaria"*.
   - Clic en el botón -> la gráfica se despliega correctamente.
4. **EventualityDetailsPage / Modal:**
   - Usuario sin permiso especial: Seleccionar un servicio del catálogo -> el precio unitario se llena automáticamente y el input permanece bloqueado/deshabilitado.
   - Usuario con permiso especial: El input de precio unitario se puede editar manualmente.
