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

describe('Tier 1: Feature Coverage (Category-Partition Testing)', () => {
  let app: INestApplication;
  let httpServer: Server;

  // Shared IDs for downstream tests within Tier 1
  let createdCategoryId: string;
  let createdCategoryCode: string;
  let createdMedicalServiceId: string;
  let createdMedicalServiceCode: string;
  let targetPlanId: string;
  let sourcePlanId: string;

  beforeAll(async () => {
    const ctx = await createE2eTestApp();
    app = ctx.app;
    httpServer = ctx.httpServer;

    // Create a base source plan and target plan via existing /plans endpoint
    const sourcePlanRes = await request(httpServer)
      .post('/plans')
      .send({
        name: 'Plan E2E Source ' + generateUniqueCode(),
        amount: 50.0,
        coverage: 5000.0,
        minAge: 18,
        maxAge: 65,
        minMonths: 12,
        commissionAmount: 5.0,
      });

    if (sourcePlanRes.status === 201) {
      sourcePlanId = sourcePlanRes.body.id;
    }

    const targetPlanRes = await request(httpServer)
      .post('/plans')
      .send({
        name: 'Plan E2E Target ' + generateUniqueCode(),
        amount: 60.0,
        coverage: 7000.0,
        minAge: 18,
        maxAge: 70,
        minMonths: 12,
        commissionAmount: 6.0,
      });

    if (targetPlanRes.status === 201) {
      targetPlanId = targetPlanRes.body.id;
    }
  }, 60000);

  afterAll(async () => {
    await closeE2eTestApp(app);
  });

  // ---------------------------------------------------------------------------
  // Feature 2: ServiceCategory Catalog (/plans/categories)
  // ---------------------------------------------------------------------------
  describe('Feature 2: ServiceCategory Catalog (/plans/categories)', () => {
    it('T1.1.1: POST /plans/categories should create a new category with valid payload', async () => {
      createdCategoryCode = generateUniqueCode('CAT');
      const payload = {
        code: createdCategoryCode,
        name: 'Laboratorio y Diagnóstico E2E',
        description: 'Categoría para análisis de sangre y pruebas diagnósticas',
        isActive: true,
      };

      const res = await request(httpServer).post('/plans/categories').send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
      expect(res.body.id).toBeDefined();
      expect(res.body.code).toBe(createdCategoryCode);
      expect(res.body.name).toBe(payload.name);
      expect(res.body.isActive).toBe(true);

      createdCategoryId = res.body.id;
    });

    it('T1.1.2: GET /plans/categories should list active categories including the created one', async () => {
      const res = await request(httpServer).get('/plans/categories');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(
        (cat: { id: string; code: string }) => cat.id === createdCategoryId,
      );
      expect(found).toBeDefined();
      expect(found.code).toBe(createdCategoryCode);
    });

    it('T1.1.3: GET /plans/categories/:id should retrieve the category by its UUID', async () => {
      const res = await request(httpServer).get(`/plans/categories/${createdCategoryId}`);

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expect(res.body.id).toBe(createdCategoryId);
      expect(res.body.code).toBe(createdCategoryCode);
    });

    it('T1.1.4: PATCH /plans/categories/:id should update category details', async () => {
      const updatePayload = {
        name: 'Laboratorio y Diagnóstico Actualizado',
        description: 'Descripción modificada en prueba E2E',
      };

      const res = await request(httpServer)
        .patch(`/plans/categories/${createdCategoryId}`)
        .send(updatePayload);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(updatePayload.name);
      expect(res.body.description).toBe(updatePayload.description);
    });
  });

  // ---------------------------------------------------------------------------
  // Feature 3: MedicalService Catalog (/plans/medical-services)
  // ---------------------------------------------------------------------------
  describe('Feature 3: MedicalService Catalog (/plans/medical-services)', () => {
    it('T1.2.1: POST /plans/medical-services should create service linked to category and health categories', async () => {
      createdMedicalServiceCode = generateUniqueCode('MED');
      const payload = {
        code: createdMedicalServiceCode,
        name: 'Electrocardiograma de Reposo E2E',
        description: 'Evaluación de la actividad eléctrica del corazón',
        categoryId: createdCategoryId,
        linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
        isActive: true,
      };

      const res = await request(httpServer).post('/plans/medical-services').send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
      expect(res.body.id).toBeDefined();
      expect(res.body.code).toBe(createdMedicalServiceCode);
      expect(res.body.categoryId).toBe(createdCategoryId);
      expect(res.body.linkedHealthCategories).toContain(HealthCategory.CARDIOVASCULAR);

      createdMedicalServiceId = res.body.id;
    });

    it('T1.2.2: GET /plans/medical-services should list services including the created one', async () => {
      const res = await request(httpServer).get('/plans/medical-services');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(
        (srv: { id: string; code: string }) => srv.id === createdMedicalServiceId,
      );
      expect(found).toBeDefined();
      expect(found.code).toBe(createdMedicalServiceCode);
    });

    it('T1.2.3: GET /plans/medical-services/:id should retrieve the medical service by UUID', async () => {
      const res = await request(httpServer).get(
        `/plans/medical-services/${createdMedicalServiceId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdMedicalServiceId);
      expect(res.body.code).toBe(createdMedicalServiceCode);
      expect(res.body.categoryId).toBe(createdCategoryId);
    });

    it('T1.2.4: PATCH /plans/medical-services/:id should update medical service attributes', async () => {
      const updatePayload = {
        name: 'Electrocardiograma con Tira de Ritmo',
        linkedHealthCategories: [HealthCategory.CARDIOVASCULAR, HealthCategory.ENDOCRINA],
      };

      const res = await request(httpServer)
        .patch(`/plans/medical-services/${createdMedicalServiceId}`)
        .send(updatePayload);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(updatePayload.name);
      expect(res.body.linkedHealthCategories).toContain(HealthCategory.ENDOCRINA);
    });
  });

  // ---------------------------------------------------------------------------
  // Feature 4: Plan Coverage Parameterization (/plans/:id/services)
  // ---------------------------------------------------------------------------
  describe('Feature 4: Plan Coverage Parameterization (/plans/:id/services)', () => {
    it('T1.3.1: POST /plans/:id/services should configure a single service with UNLIMITED limits and copay', async () => {
      const payload = {
        medicalServiceId: createdMedicalServiceId,
        limitType: PlanServiceLimitType.UNLIMITED,
        limitQuantity: null,
        waitingPeriodDays: 30,
        copayAmount: 15.0,
        copayPercentage: 10.0,
      };

      const res = await request(httpServer).post(`/plans/${sourcePlanId}/services`).send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
      expect(res.body.planId).toBe(sourcePlanId);
      expect(res.body.medicalServiceId).toBe(createdMedicalServiceId);
      expect(res.body.limitType).toBe(PlanServiceLimitType.UNLIMITED);
      expect(res.body.limitQuantity).toBeNull();
      expect(Number(res.body.waitingPeriodDays)).toBe(30);
    });

    it('T1.3.2: POST /plans/:id/services/batch should assign multiple services in batch', async () => {
      // Create a second medical service for batch assignment
      const secondServiceRes = await request(httpServer)
        .post('/plans/medical-services')
        .send({
          code: generateUniqueCode('MED2'),
          name: 'Perfil Lipídico Completo E2E',
          categoryId: createdCategoryId,
          linkedHealthCategories: [HealthCategory.ENDOCRINA],
        });

      const secondServiceId = secondServiceRes.body.id;

      const batchPayload = {
        services: [
          {
            medicalServiceId: secondServiceId,
            limitType: PlanServiceLimitType.MONTHLY,
            limitQuantity: 2,
            waitingPeriodDays: 0,
            copayAmount: 5.0,
            copayPercentage: 0,
          },
        ],
      };

      const res = await request(httpServer)
        .post(`/plans/${sourcePlanId}/services/batch`)
        .send(batchPayload);

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('T1.3.3: GET /plans/:id/services should return flat list of configured plan services', async () => {
      const res = await request(httpServer).get(`/plans/${sourcePlanId}/services`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      expect(res.body[0].planId).toBe(sourcePlanId);
    });

    it('T1.3.4: GET /plans/:id/services?grouped=true should return services grouped by category', async () => {
      const res = await request(httpServer).get(`/plans/${sourcePlanId}/services?grouped=true`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const group = res.body[0];
      expect(group.category).toBeDefined();
      expect(group.category.id).toBeDefined();
      expect(Array.isArray(group.services)).toBe(true);
      expect(group.services.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Feature 5: Atomic Plan Cloning (/plans/:id/clone-services-from/:sourcePlanId)
  // ---------------------------------------------------------------------------
  describe('Feature 5: Atomic Plan Cloning (/plans/:id/clone-services-from/:sourcePlanId)', () => {
    it('T1.4.1: POST /plans/:targetPlanId/clone-services-from/:sourcePlanId should atomically clone all services', async () => {
      const res = await request(httpServer)
        .post(`/plans/${targetPlanId}/clone-services-from/${sourcePlanId}`)
        .send();

      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
      expect(res.body.targetPlanId).toBe(targetPlanId);
      expect(res.body.sourcePlanId).toBe(sourcePlanId);
      expect(res.body.clonedCount).toBeGreaterThanOrEqual(2);
      expect(res.body.skippedCount).toBe(0);

      // Verify target plan now has the cloned services
      const verifyRes = await request(httpServer).get(`/plans/${targetPlanId}/services`);
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.length).toBe(res.body.clonedCount);
    });
  });

  // ---------------------------------------------------------------------------
  // Feature 7: Health Exclusion Pre-evaluation (/contracts/evaluate-health-exclusions)
  // ---------------------------------------------------------------------------
  describe('Feature 7: Health Exclusion Pre-evaluation (/contracts/evaluate-health-exclusions)', () => {
    it('T1.5.1: POST /contracts/evaluate-health-exclusions should suggest exclusions matching declared pathologies', async () => {
      const preEvalPayload = {
        planId: sourcePlanId,
        healthDeclarations: [
          {
            category: HealthCategory.CARDIOVASCULAR,
            hasCondition: true,
            details: 'Antecedentes de arritmia cardíaca',
          },
        ],
      };

      const res = await request(httpServer)
        .post('/contracts/evaluate-health-exclusions')
        .send(preEvalPayload);

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expect(res.body.suggestedExclusions).toBeDefined();
      expect(Array.isArray(res.body.suggestedExclusions)).toBe(true);

      // The cardiovascular service created in T1.2.1 should be suggested
      const foundExclusion = res.body.suggestedExclusions.find(
        (ex: { medicalServiceId: string }) => ex.medicalServiceId === createdMedicalServiceId,
      );
      expect(foundExclusion).toBeDefined();
      expect(foundExclusion.source).toBe('AUTOMATIC');
      expect(foundExclusion.inPlan).toBe(true);
      expect(foundExclusion.reason).toContain('CARDIOVASCULAR');
    });

    it('T1.5.2: POST /contracts/evaluate-health-exclusions should return empty suggestions when hasCondition is false', async () => {
      const preEvalPayload = {
        planId: sourcePlanId,
        healthDeclarations: [
          {
            category: HealthCategory.CARDIOVASCULAR,
            hasCondition: false,
          },
        ],
      };

      const res = await request(httpServer)
        .post('/contracts/evaluate-health-exclusions')
        .send(preEvalPayload);

      expect(res.status).toBe(200);
      expect(res.body.suggestedExclusions).toHaveLength(0);
      expect(res.body.allExclusions).toHaveLength(0);
      expect(res.body.summary.totalConditionsDeclared).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Feature 9: Person Benefits Query (/persons/:id/benefits)
  // ---------------------------------------------------------------------------
  describe('Feature 9: Person Benefits Query (/persons/:id/benefits)', () => {
    it('T1.6.1: GET /persons/:id/benefits should return 404 EntityNotFoundException when person does not exist', async () => {
      const nonExistentPersonId = '00000000-0000-0000-0000-999999999999';
      const res = await request(httpServer).get(`/persons/${nonExistentPersonId}/benefits`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBeDefined();
    });

    it('T1.6.2: GET /persons/:id/benefits should return 400 InvalidDomainOperationException when person has no active contract', async () => {
      // Create a person without contract
      const personRes = await request(httpServer)
        .post('/persons')
        .send({
          typeIdentityCard: 'V',
          identityCard: Math.floor(10000000 + Math.random() * 90000000).toString(),
          firstName: 'Juan E2E',
          lastName: 'Pérez E2E',
          gender: 'MALE',
          birthDate: '1990-05-15',
          email: `juan_${Date.now()}@test.com`,
          mobilePhone: '+584121234567',
        });

      if (personRes.status === 201) {
        const personId = personRes.body.id;
        const res = await request(httpServer).get(`/persons/${personId}/benefits`);
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('contrato activo');
      }
    });
  });
});
