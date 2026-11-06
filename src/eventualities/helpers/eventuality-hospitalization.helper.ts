/**
 * Parámetros para el cálculo de tope de cobertura y excedente a cargo del paciente.
 */
export interface CalculateCoverageCapParams {
  initialCoverage: number;
  consumedCoverage: number;
  otherReservedCoverage: number;
  requiredCoverageWithFactor: number;
  alertThresholdPercentage: number;
}

/**
 * Resultado financiero y semáforo del corte de hospitalización.
 */
export interface CoverageCapResult {
  maxAvailableToLock: number;
  effectiveLockedAmount: number;
  patientExcessAmount: number;
  consumptionPercentage: number;
  semaphore: 'GREEN' | 'YELLOW' | 'RED';
  shouldTriggerAlert: boolean;
}

/**
 * Función pura para evaluar el tope de cobertura y excedente a cargo del paciente
 * en cortes diarios de eventualidades de Hospitalización.
 */
export function calculateCoverageCapAndExcess(
  params: CalculateCoverageCapParams,
): CoverageCapResult {
  const initial = Math.max(0, Number(params.initialCoverage || 0));
  const consumed = Math.max(0, Number(params.consumedCoverage || 0));
  const otherReserved = Math.max(0, Number(params.otherReservedCoverage || 0));
  const required = Math.max(0, Number(params.requiredCoverageWithFactor || 0));
  const threshold = Number(params.alertThresholdPercentage || 80);

  const maxAvailableToLock = Math.max(0, Number((initial - consumed - otherReserved).toFixed(2)));

  const effectiveLockedAmount = Number(Math.min(required, maxAvailableToLock).toFixed(2));

  const patientExcessAmount = Math.max(0, Number((required - effectiveLockedAmount).toFixed(2)));

  const totalProjected = Number((consumed + otherReserved + effectiveLockedAmount).toFixed(2));

  const consumptionPercentage =
    initial > 0
      ? Number(Math.min(100, Number(((totalProjected / initial) * 100).toFixed(2))))
      : 100;

  let semaphore: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
  if (patientExcessAmount > 0 || consumptionPercentage >= threshold) {
    semaphore = 'RED';
  } else if (consumptionPercentage >= 60) {
    semaphore = 'YELLOW';
  }

  const shouldTriggerAlert = consumptionPercentage >= threshold || patientExcessAmount > 0;

  return {
    maxAvailableToLock,
    effectiveLockedAmount,
    patientExcessAmount,
    consumptionPercentage,
    semaphore,
    shouldTriggerAlert,
  };
}
