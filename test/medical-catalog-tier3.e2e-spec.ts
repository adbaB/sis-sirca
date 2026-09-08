import { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  closeE2eTestApp,
  createE2eTestApp,
  ExclusionSource,
  generateUniqueCode,
  HealthCategory,
  PlanServiceLimitType,
} from './e2e-test-utils';

describe('Tier 3: Pairwise Combinatorial & Cross-Feature Integration', () => {
  let app: INestApplication;
  let httpServer: Server;

  // Pipeline entities
  let categoryCardioId: string;
  let categoryLabId: string;
  let serviceCardioId: string;
  let serviceLipidsId: string;
  let serviceHematoId: string;
  let testPlanId: string;
  let testPersonId: string;
  let testContractId: string;

  beforeAll(async () => {
    const ctx = await createE2eTestApp();
    app = ctx.app;
    httpServer = ctx.httpServer;
  }, 60000);

  afterAll(async () => {
    await closeE2eTestApp(app);
  });

  // ---------------------------------------------------------------------------
  // Step 1: Multi-Category and Multi-Service Provisioning
  // ---------------------------------------------------------------------------
  describe('Step 1: Multi-Category and Medical Service Provisioning (PlansModule)', () => {
    it('T3.1.1: Should provision categories for Cardiology and Laboratory', async () => {
      const catCardioRes = await request(httpServer)
        .post('/plans/categories')
        .send({
          code: generateUniqueCode('CARD'),
          name: 'Cardiología Especializada',
        });
      expect(catCardioRes.status).toBe(201);
      categoryCardioId = catCardioRes.body.id;

      const catLabRes = await request(httpServer)
        .post('/plans/categories')
        .send({
          code: generateUniqueCode('LAB'),
          name: 'Laboratorio de Rutina y Especial',
        });
      expect(catLabRes.status).toBe(201);
      categoryLabId = catLabRes.body.id;
    });

    it('T3.1.2: Should provision medical services linked to singular, multiple, and zero health categories', async () => {
      // M1: Linked only to CARDIOVASCULAR
      const srv1Res = await request(httpServer)
        .post('/plans/medical-services')
        .send({
          code: generateUniqueCode('ECG'),
          name: 'Electrocardiograma de 12 Derivaciones',
          categoryId: categoryCardioId,
          linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
        });
      expect(srv1Res.status).toBe(201);
      serviceCardioId = srv1Res.body.id;

      // M2: Linked to CARDIOVASCULAR AND ENDOCRINA
      const srv2Res = await request(httpServer)
        .post('/plans/medical-services')
        .send({
          code: generateUniqueCode('LIP'),
          name: 'Perfil Lipídico Fraccionado',
          categoryId: categoryLabId,
          linkedHealthCategories: [HealthCategory.CARDIOVASCULAR, HealthCategory.ENDOCRINA],
        });
      expect(srv2Res.status).toBe(201);
      serviceLipidsId = srv2Res.body.id;

      // M3: General service with NO linked pathology
      const srv3Res = await request(httpServer)
        .post('/plans/medical-services')
        .send({
          code: generateUniqueCode('HEM'),
          name: 'Biometría Hemática Completa',
          categoryId: categoryLabId,
          linkedHealthCategories: [],
        });
      expect(srv3Res.status).toBe(201);
      serviceHematoId = srv3Res.body.id;
    });
  });

  // ---------------------------------------------------------------------------
  // Step 2: Pairwise Parameterization of Coverage Limits and Carencias
  // ---------------------------------------------------------------------------
  describe('Step 2: Pairwise Coverage Parameterization on Plan (PlansModule)', () => {
    it('T3.2.1: Should create a health plan and parameterize pairwise permutations of limits and carencias', async () => {
      const planRes = await request(httpServer)
        .post('/plans')
        .send({
          name: 'Plan Pairwise Matrix ' + generateUniqueCode(),
          amount: 85.0,
          coverage: 10000.0,
          minAge: 0,
          maxAge: 75,
          minMonths: 12,
          commissionAmount: 10.0,
        });
      expect(planRes.status).toBe(201);
      testPlanId = planRes.body.id;

      // Pairwise assignments:
      // Pair 1: M1 -> MONTHLY, limit=2, waitingPeriod=0d, copayAmount=5.00
      // Pair 2: M2 -> ANNUAL, limit=4, waitingPeriod=90d, copayAmount=10.00
      // Pair 3: M3 -> UNLIMITED, limit=null, waitingPeriod=30d, copayPercentage=15%
      const batchRes = await request(httpServer)
        .post(`/plans/${testPlanId}/services/batch`)
        .send({
          services: [
            {
              medicalServiceId: serviceCardioId,
              limitType: PlanServiceLimitType.MONTHLY,
              limitQuantity: 2,
              waitingPeriodDays: 0,
              copayAmount: 5.0,
              copayPercentage: 0,
            },
            {
              medicalServiceId: serviceLipidsId,
              limitType: PlanServiceLimitType.ANNUAL,
              limitQuantity: 4,
              waitingPeriodDays: 90,
              copayAmount: 10.0,
              copayPercentage: 0,
            },
            {
              medicalServiceId: serviceHematoId,
              limitType: PlanServiceLimitType.UNLIMITED,
              limitQuantity: null,
              waitingPeriodDays: 30,
              copayAmount: 0,
              copayPercentage: 15.0,
            },
          ],
        });

      expect(batchRes.status).toBe(201);
      expect(batchRes.body).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Step 3: Health Declaration Pre-Evaluation with Advisor Override
  // ---------------------------------------------------------------------------
  describe('Step 3: Pre-Evaluation & Advisor Reconciliation (ContractsModule)', () => {
    it('T3.3.1: Pre-evaluation should automatically match declared cardiovascular pathology and allow advisor overrides', async () => {
      const evalPayload = {
        planId: testPlanId,
        healthDeclarations: [
          {
            category: HealthCategory.CARDIOVASCULAR,
            hasCondition: true,
            details: 'Hipertensión arterial estadio 1 controlada',
          },
        ],
        // Advisor decides to:
        // - Retain M1 (serviceCardioId)
        // - WAIVE M2 (serviceLipidsId - omitted from manual overrides)
        // - Manually exclude M3 (serviceHematoId) due to specific underwriter note
        manualExclusions: [
          {
            medicalServiceId: serviceHematoId,
            reason: 'Exclusión preventiva por criterio de suscripción bajo análisis clínico',
            source: ExclusionSource.MANUAL,
          },
        ],
      };

      const res = await request(httpServer)
        .post('/contracts/evaluate-health-exclusions')
        .send(evalPayload);

      expect(res.status).toBe(200);
      expect(res.body.suggestedExclusions).toBeDefined();

      // Suggested should contain both services linked to CARDIOVASCULAR (M1 & M2)
      const suggestedIds = res.body.suggestedExclusions.map(
        (s: { medicalServiceId: string }) => s.medicalServiceId,
      );
      expect(suggestedIds).toContain(serviceCardioId);
      expect(suggestedIds).toContain(serviceLipidsId);

      // Manual should contain M3
      const manualIds = res.body.manualExclusions.map(
        (m: { medicalServiceId: string }) => m.medicalServiceId,
      );
      expect(manualIds).toContain(serviceHematoId);

      // In the reconciled list (allExclusions), M1 and M3 must be present
      const allIds = res.body.allExclusions.map(
        (a: { medicalServiceId: string }) => a.medicalServiceId,
      );
      expect(allIds).toContain(serviceCardioId);
      expect(allIds).toContain(serviceHematoId);
    });
  });

  // ---------------------------------------------------------------------------
  // Step 4: Contract Onboarding with Reconciled Exclusions
  // ---------------------------------------------------------------------------
  describe('Step 4: Contract Creation Integrating Exclusions (ContractsModule)', () => {
    it('T3.4.1: Should create a contract with person, health declarations, and persisted exclusions', async () => {
      const identityCard = Math.floor(20000000 + Math.random() * 70000000).toString();

      const createContractPayload = {
        code: generateUniqueCode('CTR'),
        planId: testPlanId,
        affiliationDate: new Date().toISOString().split('T')[0],
        status: 'ACTIVE',
        affiliates: [
          {
            typeIdentityCard: 'V',
            identityCard,
            firstName: 'Carlos Combinatorial',
            lastName: 'Gómez E2E',
            gender: 'MALE',
            birthDate: '1985-04-12',
            email: `carlos_${Date.now()}@test.com`,
            mobilePhone: '+584141112233',
            planId: testPlanId,
            healthDeclarations: [
              {
                category: HealthCategory.CARDIOVASCULAR,
                hasCondition: true,
                details: 'Hipertensión arterial estadio 1 controlada',
              },
            ],
            // Explicit exclusions passed to contract creation
            exclusions: [
              {
                medicalServiceId: serviceCardioId,
                reason: 'Exclusión médica por patología declarada: CARDIOVASCULAR',
                source: ExclusionSource.AUTOMATIC,
              },
              {
                medicalServiceId: serviceHematoId,
                reason: 'Exclusión preventiva por criterio de suscripción bajo análisis clínico',
                source: ExclusionSource.MANUAL,
              },
            ],
          },
        ],
      };

      const res = await request(httpServer).post('/contracts').send(createContractPayload);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      testContractId = res.body.id;

      // Find created person ID from the contract affiliates
      if (res.body.contractPersons && res.body.contractPersons.length > 0) {
        testPersonId = res.body.contractPersons[0].personId;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Step 5: Tri-State Benefits Resolution Query
  // ---------------------------------------------------------------------------
  describe('Step 5: Person Benefits Resolution (PersonsModule)', () => {
    it('T3.5.1: GET /persons/:id/benefits should report tri-state classification (COVERED, WAITING_PERIOD, EXCLUDED)', async () => {
      if (!testPersonId) {
        // Fetch person by identity card or contract if not directly returned in body
        const contractRes = await request(httpServer).get(`/contracts/${testContractId}`);
        if (contractRes.body?.contractPersons?.[0]?.personId) {
          testPersonId = contractRes.body.contractPersons[0].personId;
        }
      }

      const res = await request(httpServer).get(`/persons/${testPersonId}/benefits`);

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expect(res.body.plan).toBeDefined();
      expect(res.body.services).toBeDefined();
      expect(Array.isArray(res.body.services)).toBe(true);

      const services = res.body.services;

      // 1. serviceCardioId was excluded via health declaration
      const cardioBenefit = services.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === serviceCardioId,
      );
      expect(cardioBenefit).toBeDefined();
      expect(cardioBenefit.status).toBe('EXCLUDED');
      expect(cardioBenefit.isCovered).toBe(false);
      expect(cardioBenefit.exclusionReason).toContain('CARDIOVASCULAR');

      // 2. serviceLipidsId was WAIVED (not in exclusions), but has 90 days carencia.
      // Since affiliationDate is today (0 days elapsed), it must be in WAITING_PERIOD
      const lipidsBenefit = services.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === serviceLipidsId,
      );
      expect(lipidsBenefit).toBeDefined();
      expect(lipidsBenefit.status).toBe('WAITING_PERIOD');
      expect(lipidsBenefit.isCovered).toBe(false);
      expect(lipidsBenefit.remainingWaitingPeriodDays).toBeGreaterThan(0);

      // 3. serviceHematoId was excluded manually by advisor
      const hematoBenefit = services.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === serviceHematoId,
      );
      expect(hematoBenefit).toBeDefined();
      expect(hematoBenefit.status).toBe('EXCLUDED');
      expect(hematoBenefit.isCovered).toBe(false);
      expect(hematoBenefit.exclusionReason).toContain('criterio de suscripción');
    });
  });
});
