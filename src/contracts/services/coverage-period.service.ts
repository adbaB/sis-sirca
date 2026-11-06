import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import {
  ContractCoveragePeriod,
  CoveragePeriodStatus,
} from '../entities/contract-coverage-period.entity';
import { ContractPerson, PersonRole } from '../entities/contract-person.entity';
import { calculateContractExpirationDate } from '../helpers/contract-date-formatter.helper';
import { Transactional } from '../../common/decorators/transactional.decorator';
import { resolveQueryRunner } from '../../common/context/request-context';

@Injectable()
export class CoveragePeriodService {
  constructor(
    @InjectRepository(ContractCoveragePeriod)
    private readonly periodRepo: Repository<ContractCoveragePeriod>,
    @InjectRepository(ContractPerson)
    private readonly contractPersonRepo: Repository<ContractPerson>,
    private readonly dataSource: DataSource,
  ) {}

  private getEntityManager(manager?: EntityManager): EntityManager {
    if (manager) {
      return manager;
    }
    const qr = resolveQueryRunner(undefined, this.dataSource);
    return qr?.manager ?? this.dataSource?.manager ?? this.periodRepo.manager;
  }

  /**
   * Obtiene o inicializa el período anual de cobertura activo para un afiliado.
   */
  @Transactional()
  async getOrCreateActivePeriod(
    contractPersonId: string,
    manager?: EntityManager,
  ): Promise<ContractCoveragePeriod> {
    const em = this.getEntityManager(manager);
    const repo = em.getRepository(ContractCoveragePeriod);
    const existingPeriod = await repo.findOne({
      where: {
        contractPersonId,
        status: CoveragePeriodStatus.ACTIVE,
      },
      relations: ['contract', 'contractPerson'],
    });

    if (existingPeriod) {
      return existingPeriod;
    }

    // Si no existe, buscamos el ContractPerson y su Plan para inicializar el Período 1
    const cpRepo = em.getRepository(ContractPerson);

    const cp = await cpRepo.findOne({
      where: { id: contractPersonId },
      relations: ['contract', 'plan', 'person', 'person.plan'],
    });

    if (!cp) {
      throw new NotFoundException(`Afiliación con ID "${contractPersonId}" no encontrada.`);
    }

    const contract = cp.contract;
    const effectivePlan = cp.plan ?? cp.person?.plan;
    const initialCoverage = Number(effectivePlan?.coverage ?? 0);

    const startDate = contract.startDate
      ? new Date(contract.startDate)
      : new Date(contract.affiliationDate);

    const expirationDate = contract.expirationDate
      ? new Date(contract.expirationDate)
      : calculateContractExpirationDate(startDate);

    const newPeriod = repo.create({
      contractId: contract.id,
      contractPersonId: cp.id,
      periodNumber: 1,
      startDate,
      expirationDate,
      status: CoveragePeriodStatus.ACTIVE,
      initialCoverage,
      consumedCoverage: 0.0,
      reservedCoverage: 0.0,
      remainingCoverage: initialCoverage,
    });

    try {
      return await repo.save(newPeriod);
    } catch (error) {
      // Si otra transacción concurrente creó el período activo primero (violación del índice único UQ_ccp_active_person_period)
      const concurrent = await repo.findOne({
        where: {
          contractPersonId,
          status: CoveragePeriodStatus.ACTIVE,
        },
        relations: ['contract', 'contractPerson'],
      });
      if (concurrent) {
        return concurrent;
      }
      throw error;
    }
  }

  /**
   * Bloquea preventivamente un monto de cobertura en el período activo (Hold).
   */
  @Transactional()
  async lockCoverageAmount(
    coveragePeriodId: string,
    amountToLock: number,
    manager?: EntityManager,
  ): Promise<ContractCoveragePeriod> {
    const em = this.getEntityManager(manager);
    const repo = em.getRepository(ContractCoveragePeriod);

    const period = await repo.findOne({
      where: { id: coveragePeriodId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!period) {
      throw new NotFoundException(
        `Período de cobertura con ID "${coveragePeriodId}" no encontrado.`,
      );
    }

    if (period.status !== CoveragePeriodStatus.ACTIVE) {
      throw new BadRequestException('El período de cobertura no está activo.');
    }

    const available = Number(period.remainingCoverage);
    if (available < amountToLock) {
      throw new BadRequestException(
        `Saldo de cobertura insuficiente para bloquear la reserva. Disponible: $${available.toFixed(2)}, requerido: $${amountToLock.toFixed(2)}.`,
      );
    }

    period.reservedCoverage = Number((Number(period.reservedCoverage) + amountToLock).toFixed(2));
    period.remainingCoverage = Number((Number(period.remainingCoverage) - amountToLock).toFixed(2));

    return repo.save(period);
  }

  /**
   * Ajusta el monto bloqueado de una reserva ya existente (ej. cuando la IA extrae el consumo real).
   */
  @Transactional()
  async updateLockedCoverageAmount(
    coveragePeriodId: string,
    oldLockedAmount: number,
    newLockedAmount: number,
    manager?: EntityManager,
  ): Promise<ContractCoveragePeriod> {
    const em = this.getEntityManager(manager);
    const repo = em.getRepository(ContractCoveragePeriod);

    const period = await repo.findOne({
      where: { id: coveragePeriodId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!period) {
      throw new NotFoundException(
        `Período de cobertura con ID "${coveragePeriodId}" no encontrado.`,
      );
    }

    const diff = Number((newLockedAmount - oldLockedAmount).toFixed(2));

    if (diff > 0) {
      const available = Number(period.remainingCoverage);
      if (available < diff) {
        throw new BadRequestException(
          `Saldo de cobertura insuficiente para ajustar la reserva. Disponible: $${available.toFixed(2)}, incremento requerido: $${diff.toFixed(2)}.`,
        );
      }
    }

    period.reservedCoverage = Math.max(
      0,
      Number((Number(period.reservedCoverage) + diff).toFixed(2)),
    );
    period.remainingCoverage = Number(
      Math.max(
        0,
        Number(period.initialCoverage) -
          Number(period.consumedCoverage) -
          Number(period.reservedCoverage),
      ).toFixed(2),
    );

    return repo.save(period);
  }

  /**
   * Ajusta el monto bloqueado de una reserva con tope dinámico (sin lanzar excepción si excede el saldo).
   * Retorna el monto efectivamente bloqueado y el excedente a cargo del paciente.
   */
  @Transactional()
  async updateLockedCoverageWithCap(
    coveragePeriodId: string,
    oldLockedAmount: number,
    requestedNewLockedAmount: number,
    manager?: EntityManager,
  ): Promise<{
    period: ContractCoveragePeriod;
    actualLockedAmount: number;
    excessAmount: number;
  }> {
    const em = this.getEntityManager(manager);
    const repo = em.getRepository(ContractCoveragePeriod);

    const period = await repo.findOne({
      where: { id: coveragePeriodId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!period) {
      throw new NotFoundException(
        `Período de cobertura con ID "${coveragePeriodId}" no encontrado.`,
      );
    }

    if (period.status !== CoveragePeriodStatus.ACTIVE) {
      throw new BadRequestException('El período de cobertura no está activo.');
    }

    const availableForThisEventuality = Number(
      (Number(period.remainingCoverage) + oldLockedAmount).toFixed(2),
    );

    const actualLockedAmount = Math.max(
      0,
      Number(Math.min(requestedNewLockedAmount, availableForThisEventuality).toFixed(2)),
    );

    const excessAmount = Math.max(
      0,
      Number((requestedNewLockedAmount - actualLockedAmount).toFixed(2)),
    );

    const diff = Number((actualLockedAmount - oldLockedAmount).toFixed(2));

    period.reservedCoverage = Math.max(
      0,
      Number((Number(period.reservedCoverage) + diff).toFixed(2)),
    );
    period.remainingCoverage = Number(
      Math.max(
        0,
        Number(period.initialCoverage) -
          Number(period.consumedCoverage) -
          Number(period.reservedCoverage),
      ).toFixed(2),
    );

    const saved = await repo.save(period);

    return {
      period: saved,
      actualLockedAmount,
      excessAmount,
    };
  }

  /**
   * Libera la reserva bloqueada y registra el débito liquidado definitivo.
   */
  @Transactional()
  async releaseAndDeductCoverage(
    coveragePeriodId: string,
    lockedAmountToRelease: number,
    finalDeductedAmount: number,
    manager?: EntityManager,
  ): Promise<ContractCoveragePeriod> {
    const em = this.getEntityManager(manager);
    const repo = em.getRepository(ContractCoveragePeriod);

    const period = await repo.findOne({
      where: { id: coveragePeriodId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!period) {
      throw new NotFoundException(
        `Período de cobertura con ID "${coveragePeriodId}" no encontrado.`,
      );
    }

    // 1. Liberamos la reserva previa
    period.reservedCoverage = Math.max(
      0,
      Number((Number(period.reservedCoverage) - lockedAmountToRelease).toFixed(2)),
    );

    // 2. Sumamos al consumo liquidado definitivo
    period.consumedCoverage = Number(
      (Number(period.consumedCoverage) + finalDeductedAmount).toFixed(2),
    );

    // 3. Recalculamos el remanente real
    period.remainingCoverage = Number(
      Math.max(
        0,
        Number(period.initialCoverage) -
          Number(period.consumedCoverage) -
          Number(period.reservedCoverage),
      ).toFixed(2),
    );

    return repo.save(period);
  }

  /**
   * Cierra los períodos vigentes y abre un nuevo período anual al renovar el contrato.
   */
  @Transactional()
  async closeCurrentAndOpenNewPeriod(
    contractId: string,
    newStartDate: Date,
    newExpirationDate: Date,
    manager?: EntityManager,
  ): Promise<void> {
    const em = this.getEntityManager(manager);
    const repo = em.getRepository(ContractCoveragePeriod);
    const cpRepo = em.getRepository(ContractPerson);

    const activePeriods = await repo.find({
      where: {
        contractId,
        status: CoveragePeriodStatus.ACTIVE,
      },
    });

    const activePeriodsMap = new Map<string, ContractCoveragePeriod>();
    for (const p of activePeriods) {
      p.status = CoveragePeriodStatus.CLOSED;
      await repo.save(p);
      activePeriodsMap.set(p.contractPersonId, p);
    }

    const contractPersons = await cpRepo.find({
      where: {
        contract: { id: contractId },
        deletedAt: IsNull(),
      },
      relations: ['plan', 'person', 'person.plan'],
    });

    const safeCps = Array.isArray(contractPersons) ? contractPersons : [];

    if (safeCps.length === 0 && activePeriods.length > 0) {
      for (const p of activePeriods) {
        const cp = await cpRepo.findOne({
          where: { id: p.contractPersonId },
          relations: ['plan', 'person', 'person.plan'],
        });

        const effectivePlan = cp?.plan ?? cp?.person?.plan;
        const initialCoverage = Number(effectivePlan?.coverage ?? 0);

        const nextPeriod = repo.create({
          contractId,
          contractPersonId: p.contractPersonId,
          periodNumber: p.periodNumber + 1,
          startDate: newStartDate,
          expirationDate: newExpirationDate,
          status: CoveragePeriodStatus.ACTIVE,
          initialCoverage,
          consumedCoverage: 0.0,
          reservedCoverage: 0.0,
          remainingCoverage: initialCoverage,
        });

        await repo.save(nextPeriod);
      }
      return;
    }

    for (const cp of safeCps) {
      const effectivePlan = cp.plan ?? cp.person?.plan;
      if (!effectivePlan && cp.role !== PersonRole.AFILIADO) {
        continue;
      }

      const initialCoverage = Number(effectivePlan?.coverage ?? 0);
      const prevActive = activePeriodsMap.get(cp.id);

      let nextPeriodNumber = 1;
      if (prevActive) {
        nextPeriodNumber = prevActive.periodNumber + 1;
      } else {
        const lastPeriod = await repo.findOne({
          where: { contractPersonId: cp.id },
          order: { periodNumber: 'DESC' },
        });
        if (lastPeriod) {
          nextPeriodNumber = lastPeriod.periodNumber + 1;
        }
      }

      const nextPeriod = repo.create({
        contractId,
        contractPersonId: cp.id,
        periodNumber: nextPeriodNumber,
        startDate: newStartDate,
        expirationDate: newExpirationDate,
        status: CoveragePeriodStatus.ACTIVE,
        initialCoverage,
        consumedCoverage: 0.0,
        reservedCoverage: 0.0,
        remainingCoverage: initialCoverage,
      });

      await repo.save(nextPeriod);
    }
  }
}
