/**
 * Normaliza un número de teléfono para el envío vía WhatsApp Cloud API.
 * Retorna el número en formato E.164 únicamente con dígitos (sin el '+', espacios ni caracteres especiales).
 *
 * Ejemplos:
 * - "+58 414-1234567"  -> "584141234567"
 * - "04141234567"       -> "584141234567"
 * - "4141234567"        -> "584141234567"
 * - "584141234567"      -> "584141234567"
 * - "+1 (555) 123-4567" -> "15551234567"
 */
export function normalizeWhatsappPhone(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== 'string') return null;

  // Remover espacios, guiones, puntos y paréntesis
  let cleaned = phone.trim().replace(/[\s\-().]/g, '');

  // Remover '+' inicial si existe
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // Dejar únicamente dígitos
  cleaned = cleaned.replace(/\D/g, '');

  if (!cleaned) return null;

  // Caso Venezuela: 11 dígitos locales empezando por 0 (ej: 0414..., 0424..., 0412..., 0416..., 0426...)
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = '58' + cleaned.substring(1);
  }
  // Caso Venezuela: 10 dígitos sin el 0 inicial (ej: 414..., 424..., 412..., 422..., 416..., 426...)
  else if (
    cleaned.length === 10 &&
    (cleaned.startsWith('414') ||
      cleaned.startsWith('424') ||
      cleaned.startsWith('412') ||
      cleaned.startsWith('422') ||
      cleaned.startsWith('416') ||
      cleaned.startsWith('426'))
  ) {
    cleaned = '58' + cleaned;
  }

  // Validación de longitud según estándar internacional E.164 (10 a 15 dígitos)
  if (cleaned.length < 10 || cleaned.length > 15) {
    return null;
  }

  return cleaned;
}
