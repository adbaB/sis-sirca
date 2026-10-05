# Especificación de Diseño: Solicitud de Titular de Cuenta Zelle en Chatbot WhatsApp

- **Fecha:** 2026-10-05
- **Estado:** Aprobado

---

## 1. Contexto y Objetivos

Actualmente, cuando un usuario selecciona Zelle o envía un comprobante de pago en el bot de WhatsApp, el bot extrae la referencia y monto mediante OCR y procede a confirmar el pago para registrarlo. Sin embargo, en transacciones Zelle hacia las cuentas de la institución (Platinum Club Corp / Citibank), la conciliación bancaria exige conocer el **nombre y apellido del titular de la cuenta emisora de Zelle** para verificar la procedencia de los fondos.

Para pagos en Bolívares (Pago Móvil y Transferencia Bancaria), este dato no es requerido y el bot mantiene su flujo habitual.

### Objetivos:
1. Detectar si un pago corresponde a Zelle, ya sea porque el usuario lo seleccionó previamente o porque el análisis de comprobante (OCR) detecta que es Zelle.
2. Solicitar al usuario el nombre y apellido del titular de la cuenta Zelle antes de mostrar el resumen de confirmación.
3. Mostrar el resumen de confirmación completo incluyendo Referencia, Monto y Titular Zelle.
4. Almacenar el titular dentro de `metadata.titularZelle` en la tabla `payments`.
5. Si el usuario opta por "Ingreso manual" y ya ingresó el titular, reutilizarlo sin volver a pedirlo. Si el OCR falló completamente y no se había solicitado el titular, solicitarlo antes de procesar el pago.

---

## 2. Arquitectura de Estados del Chatbot

### Nuevo Estado
En `src/chatbot/enums/steps.enum.ts`:
- `AWAITING_ZELLE_HOLDER = 'AWAITING_ZELLE_HOLDER'`

### Ampliación del Estado de Usuario (`UserState`)
En `src/chatbot/interfaces/userState.interface.ts`:
- `zelle_holder_name?: string`

---

## 3. Lógica de Componentes

### 3.1 `OcrService` (`src/ocr/ocr.service.ts`)
- Se enriquece la interfaz `ReceiptData` con:
  - `esZelle?: boolean | null`
- Se actualiza el prompt de OpenAI Vision para que devuelva explícitamente en el JSON `esZelle: true` cuando el comprobante provenga de un banco estadounidense o de la app Zelle.

### 3.2 `AwaitingCaptureStep` (`src/chatbot/steps/stepsImp/AwaitingCapture.step.ts`)
- Tras extraer la información del comprobante:
  - Se determina si el pago es Zelle:
    - `state.payment_method === 'zelle'`, O
    - `extractedData.esZelle === true`, O
    - `extractedData.moneda === 'USD'`, O
    - El banco emisor (`extractedData.origen` / `extractedData.nombreBanco`) coincide con bancos Zelle conocidos.
  - **Si es Zelle:**
    - `state.payment_method = 'zelle'`
    - `state.step = Steps.AWAITING_ZELLE_HOLDER`
    - Mensaje al usuario:
      *"💳 He recibido tu comprobante de Zelle.\n\nPor favor, indícanos el *nombre y apellido del titular* de la cuenta Zelle desde la que realizaste el pago:"*
  - **Si es Bolívares:**
    - Se mantiene el flujo existente pasando a `Steps.AWAITING_CONFIRMATION`.

### 3.3 Nuevo Handler: `AwaitingZelleHolderStep` (`src/chatbot/steps/stepsImp/AwaitingZelleHolder.step.ts`)
- Atiende `Steps.AWAITING_ZELLE_HOLDER`.
- Valida el texto recibido:
  - Mínimo 3 caracteres, que contenga letras, no solo números ni vacío.
  - Si no es válido: envía mensaje de error amable y solicita nuevamente el nombre.
- Si es válido:
  - Almacena `state.zelle_holder_name = text.trim()`.
  - Si existe `state.extracted_data`, actualiza `state.extracted_data.titularZelle = text.trim()`.
  - Actualiza `state.step = Steps.AWAITING_CONFIRMATION`.
  - Envía mensaje interactivo con el resumen:
    *"He revisado tu comprobante y esto es lo que encontré: ✨\n\n📝 *Referencia:* {ref}\n💰 *Monto:* {monto} USD\n👤 *Titular Zelle:* {titular}\n\n¿Me confirmas si los datos están correctos para continuar? 👍"*
    Con botones: `Sí, son correctos` y `Ingreso manual`.

### 3.4 `AwaitingConfirmationStep` (`src/chatbot/steps/stepsImp/AwaitingConfirmation.step.ts`)
- Si `datos_correctos`: pasa a `ChatbotPaymentService.processPaymentForInvoices`.
- Si `datos_incorrectos`: pasa a `Steps.AWAITING_MANUAL_INPUT`.

### 3.5 `AwaitingManualInputStep` (`src/chatbot/steps/stepsImp/AwaitingManualInput.step.ts`)
- Si el usuario ya tenía `state.zelle_holder_name` registrado, lo conserva.
- Si no lo tenía pero el método es Zelle (o el banco ingresado es Zelle):
  - Guarda los datos manuales de monto y referencia.
  - Pasa a `Steps.AWAITING_ZELLE_HOLDER` para solicitar el titular antes de proceder al pago.

### 3.6 `ChatbotPaymentService` (`src/chatbot/services/chatbot-payment.service.ts`)
- Al crear el pago en `createPayment`, añade `titularZelle: state.zelle_holder_name` a `ocrMetadata`.
- Se almacena dentro del campo `metadata` (JSONB) de `Payment`.

---

## 4. Registro en el Módulo

En `src/chatbot/chatbot.module.ts`:
- Registrar `AwaitingZelleHolderStep` en los `providers` y en la inyección de steps del chatbot.
