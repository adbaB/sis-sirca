import { PlanService, PlanServiceLimitType } from './plan-service.entity';
import { Plan } from './plan.entity';
import { MedicalService } from './medical-service.entity';

describe('PlanService Entity', () => {
  it('should have PlanServiceLimitType enum values defined', () => {
    expect(PlanServiceLimitType.UNLIMITED).toBe('UNLIMITED');
    expect(PlanServiceLimitType.MONTHLY).toBe('MONTHLY');
    expect(PlanServiceLimitType.ANNUAL).toBe('ANNUAL');
  });

  it('should instantiate with UNLIMITED limit type configuration', () => {
    const ps = new PlanService();
    ps.id = 'ps-uuid-1';
    ps.planId = 'plan-uuid-1';
    ps.medicalServiceId = 'service-uuid-1';
    ps.limitType = PlanServiceLimitType.UNLIMITED;
    ps.limitQuantity = null;
    ps.waitingPeriodDays = 30;
    ps.copayAmount = 5.0;
    ps.copayPercentage = 10.0;
    ps.createdAt = new Date();
    ps.updatedAt = new Date();
    ps.deletedAt = null;

    expect(ps.limitType).toBe(PlanServiceLimitType.UNLIMITED);
    expect(ps.limitQuantity).toBeNull();
    expect(ps.waitingPeriodDays).toBe(30);
    expect(ps.copayAmount).toBe(5.0);
    expect(ps.copayPercentage).toBe(10.0);
  });

  it('should instantiate with MONTHLY limit type configuration', () => {
    const ps = new PlanService();
    ps.planId = 'plan-uuid-1';
    ps.medicalServiceId = 'service-uuid-2';
    ps.limitType = PlanServiceLimitType.MONTHLY;
    ps.limitQuantity = 2;
    ps.waitingPeriodDays = 0;
    ps.copayAmount = 0;
    ps.copayPercentage = 0;

    expect(ps.limitType).toBe(PlanServiceLimitType.MONTHLY);
    expect(ps.limitQuantity).toBe(2);
  });

  it('should associate with Plan and MedicalService', () => {
    const plan = new Plan();
    plan.id = 'p-1';
    plan.name = 'Gold Plan';

    const service = new MedicalService();
    service.id = 'ms-1';
    service.name = 'Consulta General';

    const ps = new PlanService();
    ps.plan = plan;
    ps.planId = plan.id;
    ps.medicalService = service;
    ps.medicalServiceId = service.id;

    expect(ps.plan.name).toBe('Gold Plan');
    expect(ps.medicalService.name).toBe('Consulta General');
  });
});
