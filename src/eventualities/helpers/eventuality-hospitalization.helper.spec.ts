import { describe, expect, it } from 'vitest';
import { calculateCoverageCapAndExcess } from './eventuality-hospitalization.helper';

describe('eventuality-hospitalization.helper', () => {
  it('debe calcular semáforo VERDE cuando el consumo proyectado es bajo (<60%) y no hay excedente', () => {
    const result = calculateCoverageCapAndExcess({
      initialCoverage: 1000,
      consumedCoverage: 100,
      otherReservedCoverage: 50,
      requiredCoverageWithFactor: 300,
      alertThresholdPercentage: 80,
    });

    // 100 + 50 + 300 = 450 (45%)
    expect(result.maxAvailableToLock).toBe(850);
    expect(result.effectiveLockedAmount).toBe(300);
    expect(result.patientExcessAmount).toBe(0);
    expect(result.consumptionPercentage).toBe(45);
    expect(result.semaphore).toBe('GREEN');
    expect(result.shouldTriggerAlert).toBe(false);
  });

  it('debe calcular semáforo AMARILLO cuando el consumo proyectado está entre 60% y el umbral de alerta (80%)', () => {
    const result = calculateCoverageCapAndExcess({
      initialCoverage: 1000,
      consumedCoverage: 200,
      otherReservedCoverage: 100,
      requiredCoverageWithFactor: 400,
      alertThresholdPercentage: 80,
    });

    // 200 + 100 + 400 = 700 (70%)
    expect(result.maxAvailableToLock).toBe(700);
    expect(result.effectiveLockedAmount).toBe(400);
    expect(result.patientExcessAmount).toBe(0);
    expect(result.consumptionPercentage).toBe(70);
    expect(result.semaphore).toBe('YELLOW');
    expect(result.shouldTriggerAlert).toBe(false);
  });

  it('debe calcular semáforo ROJO y activar alerta cuando alcanza o supera el umbral configurado (ej: 80%)', () => {
    const result = calculateCoverageCapAndExcess({
      initialCoverage: 1000,
      consumedCoverage: 300,
      otherReservedCoverage: 100,
      requiredCoverageWithFactor: 450,
      alertThresholdPercentage: 80,
    });

    // 300 + 100 + 450 = 850 (85%)
    expect(result.maxAvailableToLock).toBe(600);
    expect(result.effectiveLockedAmount).toBe(450);
    expect(result.patientExcessAmount).toBe(0);
    expect(result.consumptionPercentage).toBe(85);
    expect(result.semaphore).toBe('RED');
    expect(result.shouldTriggerAlert).toBe(true);
  });

  it('debe aplicar TOPE sin error y calcular el excedente a cargo del paciente cuando supera el 100% de la póliza', () => {
    const result = calculateCoverageCapAndExcess({
      initialCoverage: 1000,
      consumedCoverage: 400,
      otherReservedCoverage: 200,
      requiredCoverageWithFactor: 700,
      alertThresholdPercentage: 80,
    });

    // maxAvailableToLock = 1000 - 400 - 200 = 400
    // Requerido = 700 -> effectiveLockedAmount = 400
    // Excedente paciente = 700 - 400 = 300
    expect(result.maxAvailableToLock).toBe(400);
    expect(result.effectiveLockedAmount).toBe(400);
    expect(result.patientExcessAmount).toBe(300);
    expect(result.consumptionPercentage).toBe(100);
    expect(result.semaphore).toBe('RED');
    expect(result.shouldTriggerAlert).toBe(true);
  });

  it('debe manejar cobertura inicial cero o negativa de forma segura', () => {
    const result = calculateCoverageCapAndExcess({
      initialCoverage: 0,
      consumedCoverage: 0,
      otherReservedCoverage: 0,
      requiredCoverageWithFactor: 200,
      alertThresholdPercentage: 80,
    });

    expect(result.maxAvailableToLock).toBe(0);
    expect(result.effectiveLockedAmount).toBe(0);
    expect(result.patientExcessAmount).toBe(200);
    expect(result.consumptionPercentage).toBe(100);
    expect(result.semaphore).toBe('RED');
    expect(result.shouldTriggerAlert).toBe(true);
  });
});
