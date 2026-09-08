import { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  closeE2eTestApp,
  createE2eTestApp,
  generateUniqueCode,
  HealthCategory,
  PlanServiceLimitType,
} from './e2e-test-utils';

describe('Tier 2: Boundary Value Analysis & Corner Cases', () => {
  let app: INestApplication;
  let httpServer: Server;

  let testCategoryId: string;
  let testMedicalServiceId1: string;
  let testMedicalServiceId2: string;
  let testPlanAId: string;
  let testPlanBId: string;

  beforeAll(async () => {
    const ctx = await createE2eTestApp();
    app = ctx.app;
    httpServer = ctx.httpServer;

    // Create a base category
    const catRes = await request(httpServer)
      .post('/plans/categories')
      .send({
        code: generateUniqueCode('CAT_T2'),
        name: 'Categoría Tier 2 Boundary Tests',
      });
    if (catRes.status === 201) {
      testCategoryId = catRes.body.id;
    }

    // Create medical services
    const srv1Res = await request(httpServer)
      .post('/plans/medical-services')
      .send({
        code: generateUniqueCode('SRV1_T2'),
        name: 'Servicio Boundary 1',
        categoryId: testCategoryId,
        linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
      });
    if (srv1Res.status === 201) {
      testMedicalServiceId1 = srv1Res.body.id;
    }

    const srv2Res = await request(httpServer)
      .post('/plans/medical-services')
      .send({
        code: generateUniqueCode('SRV2_T2'),
        name: 'Servicio Boundary 2',
        categoryId: testCategoryId,
      });
    if (srv2Res.status === 201) {
      testMedicalServiceId2 = srv2Res.body.id;
    }

    // Create test plans
    const planARes = await request(httpServer)
      .post('/plans')
      .send({
        name: 'Plan A ' + generateUniqueCode(),
        amount: 50.0,
        coverage: 5000.0,
        minAge: 18,
        maxAge: 65,
        minMonths: 12,
        commissionAmount: 5.0,
      });
    if (planARes.status === 201) {
      testPlanAId = planARes.body.id;
    }

    const planBRes = await request(httpServer)
      .post('/plans')
      .send({
        name: 'Plan B ' + generateUniqueCode(),
        amount: 50.0,
        coverage: 5000.0,
        minAge: 18,
        maxAge: 65,
        minMonths: 12,
        commissionAmount: 5.0,
      });
    if (planBRes.status === 201) {
      testPlanBId = planBRes.body.id;
    }
  }, 60000);

  afterAll(async () => {
    await closeE2eTestApp(app);
  });

  // ---------------------------------------------------------------------------
  // 1. Limit Rule Boundaries (limitType vs limitQuantity)
  // ---------------------------------------------------------------------------
  describe('Limit Rule Boundaries (limitType vs limitQuantity)', () => {
    it('T2.1.1: UNLIMITED limitType with non-null limitQuantity should return 400 Bad Request', async () => {
      const res = await request(httpServer).post(`/plans/${testPlanAId}/services`).send({
        medicalServiceId: testMedicalServiceId1,
        limitType: PlanServiceLimitType.UNLIMITED,
        limitQuantity: 5, // Invalid for UNLIMITED
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('UNLIMITED');
    });

    it('T2.1.2: MONTHLY limitType with limitQuantity = 0 should return 400 Bad Request', async () => {
      const res = await request(httpServer).post(`/plans/${testPlanAId}/services`).send({
        medicalServiceId: testMedicalServiceId1,
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: 0, // Must be >= 1
      });

      expect(res.status).toBe(400);
    });

    it('T2.1.3: MONTHLY limitType with negative limitQuantity should return 400 Bad Request', async () => {
      const res = await request(httpServer).post(`/plans/${testPlanAId}/services`).send({
        medicalServiceId: testMedicalServiceId1,
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: -3,
      });

      expect(res.status).toBe(400);
    });

    it('T2.1.4: MONTHLY limitType with null limitQuantity should return 400 Bad Request', async () => {
      const res = await request(httpServer).post(`/plans/${testPlanAId}/services`).send({
        medicalServiceId: testMedicalServiceId1,
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: null,
      });

      expect(res.status).toBe(400);
    });

    it('T2.1.5: MONTHLY limitType with limitQuantity = 1 (minimum boundary) should succeed with 201', async () => {
      const res = await request(httpServer).post(`/plans/${testPlanAId}/services`).send({
        medicalServiceId: testMedicalServiceId1,
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: 1,
      });

      expect(res.status).toBe(201);
      expect(res.body.limitType).toBe(PlanServiceLimitType.MONTHLY);
      expect(res.body.limitQuantity).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Waiting Period & Copay Numerical Boundaries
  // ---------------------------------------------------------------------------
  describe('Waiting Period & Copay Numerical Boundaries', () => {
    it('T2.2.1: waitingPeriodDays = 0 (minimum non-negative) should succeed with 201', async () => {
      const res = await request(httpServer).post(`/plans/${testPlanAId}/services`).send({
        medicalServiceId: testMedicalServiceId2,
        limitType: PlanServiceLimitType.UNLIMITED,
        limitQuantity: null,
        waitingPeriodDays: 0,
      });

      expect(res.status).toBe(201);
      expect(Number(res.body.waitingPeriodDays)).toBe(0);
    });

    it('T2.2.2: Negative waitingPeriodDays (-5) should return 400 Bad Request', async () => {
      const res = await request(httpServer).post(`/plans/${testPlanBId}/services`).send({
        medicalServiceId: testMedicalServiceId1,
        limitType: PlanServiceLimitType.UNLIMITED,
        waitingPeriodDays: -5,
      });

      expect(res.status).toBe(400);
    });

    it('T2.2.3: copayPercentage = 0 and copayPercentage = 100 should be valid boundaries', async () => {
      // 0%
      const resZero = await request(httpServer).post(`/plans/${testPlanBId}/services`).send({
        medicalServiceId: testMedicalServiceId1,
        limitType: PlanServiceLimitType.UNLIMITED,
        copayPercentage: 0,
      });
      expect(resZero.status).toBe(201);

      // 100% on a different plan
      const freshPlanRes = await request(httpServer)
        .post('/plans')
        .send({
          name: 'Plan Copay 100 ' + generateUniqueCode(),
          amount: 50.0,
          coverage: 5000.0,
          minAge: 18,
          maxAge: 65,
          minMonths: 12,
          commissionAmount: 5.0,
        });

      if (freshPlanRes.status === 201) {
        const resHundred = await request(httpServer)
          .post(`/plans/${freshPlanRes.body.id}/services`)
          .send({
            medicalServiceId: testMedicalServiceId1,
            limitType: PlanServiceLimitType.UNLIMITED,
            copayPercentage: 100,
          });
        expect(resHundred.status).toBe(201);
      }
    });

    it('T2.2.4: copayPercentage > 100 or < 0 should return 400 Bad Request', async () => {
      const resExceed = await request(httpServer).post(`/plans/${testPlanBId}/services`).send({
        medicalServiceId: testMedicalServiceId2,
        limitType: PlanServiceLimitType.UNLIMITED,
        copayPercentage: 100.5,
      });
      expect(resExceed.status).toBe(400);

      const resNegative = await request(httpServer).post(`/plans/${testPlanBId}/services`).send({
        medicalServiceId: testMedicalServiceId2,
        limitType: PlanServiceLimitType.UNLIMITED,
        copayPercentage: -5,
      });
      expect(resNegative.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Plan Cloning Corner Cases
  // ---------------------------------------------------------------------------
  describe('Plan Cloning Corner Cases', () => {
    it('T2.3.1: Self-cloning (targetPlanId === sourcePlanId) should return 400 Bad Request', async () => {
      const res = await request(httpServer)
        .post(`/plans/${testPlanAId}/clone-services-from/${testPlanAId}`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('sobre sí mismo');
    });

    it('T2.3.2: Cloning to/from non-existent plan should return 404 EntityNotFoundException', async () => {
      const ghostId = '00000000-0000-0000-0000-999999999999';
      const res = await request(httpServer)
        .post(`/plans/${testPlanAId}/clone-services-from/${ghostId}`)
        .send();

      expect(res.status).toBe(404);
    });

    it('T2.3.3: Cloning should skip existing services (deduplication) without error', async () => {
      // testPlanA has service1 and service2. testPlanB already has service1.
      // Cloning from A to B should clone service2 and skip service1.
      const res = await request(httpServer)
        .post(`/plans/${testPlanBId}/clone-services-from/${testPlanAId}`)
        .send();

      expect(res.status).toBe(201);
      expect(res.body.targetPlanId).toBe(testPlanBId);
      expect(res.body.sourcePlanId).toBe(testPlanAId);
      expect(res.body.skippedCount).toBeGreaterThanOrEqual(1);

      // Re-running the exact same cloning operation should now skip everything (idempotence)
      const resIdempotent = await request(httpServer)
        .post(`/plans/${testPlanBId}/clone-services-from/${testPlanAId}`)
        .send();

      expect(resIdempotent.status).toBe(201);
      expect(resIdempotent.body.clonedCount).toBe(0);
      expect(resIdempotent.body.skippedCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Relational & Soft-Delete Conflicts
  // ---------------------------------------------------------------------------
  describe('Relational & Soft-Delete Conflicts', () => {
    it('T2.4.1: Duplicate active category code should return 409 Conflict', async () => {
      const code = generateUniqueCode('DUP_CAT');

      // Create first active category
      const res1 = await request(httpServer)
        .post('/plans/categories')
        .send({ code, name: 'Primera Categoría' });
      expect(res1.status).toBe(201);

      // Attempt to create second category with identical code
      const res2 = await request(httpServer)
        .post('/plans/categories')
        .send({ code, name: 'Segunda Categoría Duplicada' });
      expect(res2.status).toBe(409);
    });

    it('T2.4.2: Soft-delete allows code reuse (partial unique index where deleted_at is null)', async () => {
      const code = generateUniqueCode('REUSE_CAT');

      // 1. Create
      const res1 = await request(httpServer)
        .post('/plans/categories')
        .send({ code, name: 'Original Category' });
      expect(res1.status).toBe(201);
      const catId = res1.body.id;

      // 2. Soft delete
      const deleteRes = await request(httpServer).delete(`/plans/categories/${catId}`);
      expect(deleteRes.status).toBe(200);

      // 3. Re-create with exact same code -> Should SUCCEED
      const res2 = await request(httpServer)
        .post('/plans/categories')
        .send({ code, name: 'Reincarnated Category with Same Code' });
      expect(res2.status).toBe(201);
      expect(res2.body.code).toBe(code);
      expect(res2.body.id).not.toBe(catId);
    });

    it('T2.4.3: Soft-deleting a category with active medical services should return 400 Bad Request', async () => {
      // testCategoryId has active medical services attached to it (testMedicalServiceId1, 2)
      const res = await request(httpServer).delete(`/plans/categories/${testCategoryId}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('servicios activos');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Security & Authorization Boundary Simulation
  // ---------------------------------------------------------------------------
  describe('Security & Authorization Boundary Simulation', () => {
    it('T2.5.1: Request with unauthorized header should simulate 401 Unauthorized', async () => {
      const res = await request(httpServer)
        .get('/plans/categories')
        .set('x-simulate-unauthorized', 'true');

      expect(res.status).toBe(401);
    });

    it('T2.5.2: Request with forbidden header should simulate 403 Forbidden', async () => {
      const res = await request(httpServer)
        .post('/plans/categories')
        .set('x-simulate-forbidden', 'true')
        .send({
          code: generateUniqueCode('FORBIDDEN'),
          name: 'Forbidden Test',
        });

      expect(res.status).toBe(403);
    });
  });
});
