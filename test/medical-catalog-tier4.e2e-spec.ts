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

describe('Tier 4: Real-World Workload Testing (End-to-End Scenarios)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const ctx = await createE2eTestApp();
    app = ctx.app;
    httpServer = ctx.httpServer;
  }, 60000);

  afterAll(async () => {
    await closeE2eTestApp(app);
  });

  // ===========================================================================
  // Scenario 1: Family Onboarding with Underwriter Review & Multi-Affiliate Isolation
  // ===========================================================================
  describe('Scenario 1: Family Onboarding with Underwriter Review & Multi-Affiliate Isolation', () => {
    let familyPlanId: string;
    let serviceCardioId: string;
    let servicePulmonaryId: string;
    let serviceGeneralConsultId: string;
    let contractId: string;
    let titularPersonId: string;
    let dependentPersonId: string;

    it('T4.1.1: Setup healthcare catalog with diverse medical specialties', async () => {
      // Category
      const catRes = await request(httpServer)
        .post('/plans/categories')
        .send({
          code: generateUniqueCode('CAT_FAM'),
          name: 'Especialidades Médicas Familiares',
        });
      expect(catRes.status).toBe(201);
      const categoryId = catRes.body.id;

      // S1: Cardiovascular
      const srv1 = await request(httpServer)
        .post('/plans/medical-services')
        .send({
          code: generateUniqueCode('CARDIO_SP'),
          name: 'Ecocardiograma Doppler Color',
          categoryId,
          linkedHealthCategories: [HealthCategory.CARDIOVASCULAR],
        });
      expect(srv1.status).toBe(201);
      serviceCardioId = srv1.body.id;

      // S2: Respiratoria
      const srv2 = await request(httpServer)
        .post('/plans/medical-services')
        .send({
          code: generateUniqueCode('RESP_SP'),
          name: 'Espirometría Computarizada y Test Broncodilatador',
          categoryId,
          linkedHealthCategories: [HealthCategory.RESPIRATORIA],
        });
      expect(srv2.status).toBe(201);
      servicePulmonaryId = srv2.body.id;

      // S3: General consultation (no exclusions)
      const srv3 = await request(httpServer)
        .post('/plans/medical-services')
        .send({
          code: generateUniqueCode('GEN_SP'),
          name: 'Consulta de Medicina General',
          categoryId,
          linkedHealthCategories: [],
        });
      expect(srv3.status).toBe(201);
      serviceGeneralConsultId = srv3.body.id;

      // Plan
      const planRes = await request(httpServer)
        .post('/plans')
        .send({
          name: 'Plan Familiar Platino ' + generateUniqueCode(),
          amount: 120.0,
          coverage: 15000.0,
          minAge: 0,
          maxAge: 80,
          minMonths: 12,
          commissionAmount: 15.0,
        });
      expect(planRes.status).toBe(201);
      familyPlanId = planRes.body.id;

      // Assign all 3 services to the plan
      const batchRes = await request(httpServer)
        .post(`/plans/${familyPlanId}/services/batch`)
        .send({
          services: [
            {
              medicalServiceId: serviceCardioId,
              limitType: PlanServiceLimitType.ANNUAL,
              limitQuantity: 3,
              waitingPeriodDays: 0,
              copayAmount: 10.0,
            },
            {
              medicalServiceId: servicePulmonaryId,
              limitType: PlanServiceLimitType.ANNUAL,
              limitQuantity: 3,
              waitingPeriodDays: 0,
              copayAmount: 10.0,
            },
            {
              medicalServiceId: serviceGeneralConsultId,
              limitType: PlanServiceLimitType.UNLIMITED,
              limitQuantity: null,
              waitingPeriodDays: 0,
              copayAmount: 0.0,
            },
          ],
        });
      expect(batchRes.status).toBe(201);
    });

    it('T4.1.2: Perform pre-evaluation for applicant declaring chronic hypertension', async () => {
      const evalRes = await request(httpServer)
        .post('/contracts/evaluate-health-exclusions')
        .send({
          planId: familyPlanId,
          healthDeclarations: [
            {
              category: HealthCategory.CARDIOVASCULAR,
              hasCondition: true,
              details: 'Hipertensión arterial diagnosticada en 2021',
            },
          ],
        });

      expect(evalRes.status).toBe(200);
      const suggested = evalRes.body.suggestedExclusions;
      expect(
        suggested.some((s: { medicalServiceId: string }) => s.medicalServiceId === serviceCardioId),
      ).toBe(true);
      expect(
        suggested.some(
          (s: { medicalServiceId: string }) => s.medicalServiceId === servicePulmonaryId,
        ),
      ).toBe(false);
    });

    it('T4.1.3: Create contract with Titular (hypertension) and Dependent Child (asthma)', async () => {
      const titularIdCard = Math.floor(10000000 + Math.random() * 80000000).toString();
      const dependentIdCard = Math.floor(10000000 + Math.random() * 80000000).toString();

      const contractRes = await request(httpServer)
        .post('/contracts')
        .send({
          code: generateUniqueCode('CTR_FAM'),
          planId: familyPlanId,
          affiliationDate: new Date().toISOString().split('T')[0],
          status: 'ACTIVE',
          affiliates: [
            // Titular with CARDIOVASCULAR exclusion
            {
              typeIdentityCard: 'V',
              identityCard: titularIdCard,
              firstName: 'Roberto',
              lastName: 'Familia Titular',
              gender: 'MALE',
              birthDate: '1980-02-10',
              email: `roberto_${Date.now()}@test.com`,
              mobilePhone: '+584123334455',
              planId: familyPlanId,
              healthDeclarations: [
                {
                  category: HealthCategory.CARDIOVASCULAR,
                  hasCondition: true,
                  details: 'Hipertensión arterial diagnosticada en 2021',
                },
              ],
              exclusions: [
                {
                  medicalServiceId: serviceCardioId,
                  reason: 'Exclusión médica por patología: CARDIOVASCULAR',
                  source: ExclusionSource.AUTOMATIC,
                },
              ],
            },
            // Dependent with RESPIRATORIA exclusion
            {
              typeIdentityCard: 'V',
              identityCard: dependentIdCard,
              firstName: 'Mateo',
              lastName: 'Familia Hijo',
              gender: 'MALE',
              birthDate: '2015-08-20',
              email: `mateo_${Date.now()}@test.com`,
              mobilePhone: '+584123334455',
              relationship: 'HIJO',
              planId: familyPlanId,
              healthDeclarations: [
                {
                  category: HealthCategory.RESPIRATORIA,
                  hasCondition: true,
                  details: 'Asma bronquial intermitente',
                },
              ],
              exclusions: [
                {
                  medicalServiceId: servicePulmonaryId,
                  reason: 'Exclusión médica por patología: RESPIRATORIA',
                  source: ExclusionSource.AUTOMATIC,
                },
              ],
            },
          ],
        });

      expect(contractRes.status).toBe(201);
      contractId = contractRes.body.id;
      expect(contractId).toBeDefined();

      if (contractRes.body.contractPersons && contractRes.body.contractPersons.length >= 2) {
        titularPersonId = contractRes.body.contractPersons[0].personId;
        dependentPersonId = contractRes.body.contractPersons[1].personId;
      }
    });

    it('T4.1.4: Verify complete benefits isolation between Titular and Dependent', async () => {
      // 1. Check Titular Benefits
      const titularRes = await request(httpServer).get(`/persons/${titularPersonId}/benefits`);
      expect(titularRes.status).toBe(200);

      const titularServices = titularRes.body.services;
      const titularCardio = titularServices.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === serviceCardioId,
      );
      const titularPulmonary = titularServices.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === servicePulmonaryId,
      );
      const titularGeneral = titularServices.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === serviceGeneralConsultId,
      );

      expect(titularCardio.status).toBe('EXCLUDED');
      expect(titularCardio.isCovered).toBe(false);
      expect(titularPulmonary.status).toBe('COVERED');
      expect(titularPulmonary.isCovered).toBe(true);
      expect(titularGeneral.status).toBe('COVERED');
      expect(titularGeneral.isCovered).toBe(true);

      // 2. Check Dependent Benefits
      const dependentRes = await request(httpServer).get(`/persons/${dependentPersonId}/benefits`);
      expect(dependentRes.status).toBe(200);

      const depServices = dependentRes.body.services;
      const depCardio = depServices.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === serviceCardioId,
      );
      const depPulmonary = depServices.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === servicePulmonaryId,
      );
      const depGeneral = depServices.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === serviceGeneralConsultId,
      );

      expect(depCardio.status).toBe('COVERED');
      expect(depCardio.isCovered).toBe(true);
      expect(depPulmonary.status).toBe('EXCLUDED');
      expect(depPulmonary.isCovered).toBe(false);
      expect(depGeneral.status).toBe('COVERED');
      expect(depGeneral.isCovered).toBe(true);
    });
  });

  // ===========================================================================
  // Scenario 2: Annual Plan Evolution & Atomic Cloning Workflow
  // ===========================================================================
  describe('Scenario 2: Annual Plan Evolution & Atomic Cloning Workflow', () => {
    let plan2026Id: string;
    let plan2027Id: string;
    let sampleServiceId: string;

    it('T4.2.1: Should clone plan configuration from 2026 to 2027 and maintain isolation upon modification', async () => {
      // 1. Create a service
      const catRes = await request(httpServer)
        .post('/plans/categories')
        .send({ code: generateUniqueCode('CAT_EVO'), name: 'Categoría Evolución Anual' });
      const srvRes = await request(httpServer)
        .post('/plans/medical-services')
        .send({
          code: generateUniqueCode('SRV_EVO'),
          name: 'Consulta Especializada de Reumatología',
          categoryId: catRes.body.id,
        });
      sampleServiceId = srvRes.body.id;

      // 2. Create Plan 2026 with copay $10
      const p2026Res = await request(httpServer)
        .post('/plans')
        .send({
          name: 'Plan Salud 2026 ' + generateUniqueCode(),
          amount: 50.0,
          coverage: 5000.0,
          minAge: 18,
          maxAge: 65,
          minMonths: 12,
          commissionAmount: 5.0,
        });
      plan2026Id = p2026Res.body.id;

      await request(httpServer).post(`/plans/${plan2026Id}/services`).send({
        medicalServiceId: sampleServiceId,
        limitType: PlanServiceLimitType.MONTHLY,
        limitQuantity: 2,
        waitingPeriodDays: 15,
        copayAmount: 10.0,
      });

      // 3. Create Plan 2027 (empty initially)
      const p2027Res = await request(httpServer)
        .post('/plans')
        .send({
          name: 'Plan Salud 2027 ' + generateUniqueCode(),
          amount: 60.0,
          coverage: 6000.0,
          minAge: 18,
          maxAge: 65,
          minMonths: 12,
          commissionAmount: 6.0,
        });
      plan2027Id = p2027Res.body.id;

      // 4. Clone from 2026 to 2027
      const cloneRes = await request(httpServer)
        .post(`/plans/${plan2027Id}/clone-services-from/${plan2026Id}`)
        .send();

      expect(cloneRes.status).toBe(201);
      expect(cloneRes.body.clonedCount).toBe(1);

      // 5. Verify cloned service in 2027
      const srv2027ListRes = await request(httpServer).get(`/plans/${plan2027Id}/services`);
      expect(srv2027ListRes.status).toBe(200);
      const clonedPs = srv2027ListRes.body[0];
      expect(Number(clonedPs.copayAmount)).toBe(10.0);

      // 6. Update 2027 service copay to $20
      const patchRes = await request(httpServer)
        .patch(`/plans/${plan2027Id}/services/${clonedPs.id}`)
        .send({
          copayAmount: 20.0,
        });
      expect(patchRes.status).toBe(200);

      // 7. Verify 2026 plan service was NOT mutated (isolation)
      const srv2026ListRes = await request(httpServer).get(`/plans/${plan2026Id}/services`);
      expect(srv2026ListRes.status).toBe(200);
      expect(Number(srv2026ListRes.body[0].copayAmount)).toBe(10.0);
    });
  });

  // ===========================================================================
  // Scenario 3: Mid-Term Beneficiary Addition & Dynamic Carencia Maturation
  // ===========================================================================
  describe('Scenario 3: Mid-Term Beneficiary Addition & Dynamic Carencia Maturation', () => {
    it('T4.3.1: Should correctly calculate elapsed days vs waitingPeriodDays for matured vs active carencias', async () => {
      // 1. Create a plan with a 30-day waiting period service
      const catRes = await request(httpServer)
        .post('/plans/categories')
        .send({ code: generateUniqueCode('CAT_MAT'), name: 'Categoría Carencia' });
      const srvRes = await request(httpServer)
        .post('/plans/medical-services')
        .send({
          code: generateUniqueCode('SRV_MAT'),
          name: 'Procedimiento Quirúrgico Ambulatorio',
          categoryId: catRes.body.id,
        });

      const planRes = await request(httpServer)
        .post('/plans')
        .send({
          name: 'Plan Carencia ' + generateUniqueCode(),
          amount: 70.0,
          coverage: 8000.0,
          minAge: 18,
          maxAge: 70,
          minMonths: 12,
          commissionAmount: 7.0,
        });

      await request(httpServer).post(`/plans/${planRes.body.id}/services`).send({
        medicalServiceId: srvRes.body.id,
        limitType: PlanServiceLimitType.ANNUAL,
        limitQuantity: 2,
        waitingPeriodDays: 30, // 30 days carencia
      });

      // 2. Create contract with affiliationDate set to 60 DAYS AGO (matured)
      const pastDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const identityCard = Math.floor(10000000 + Math.random() * 80000000).toString();

      const contractRes = await request(httpServer)
        .post('/contracts')
        .send({
          code: generateUniqueCode('CTR_MAT'),
          planId: planRes.body.id,
          affiliationDate: pastDate,
          status: 'ACTIVE',
          affiliates: [
            {
              typeIdentityCard: 'V',
              identityCard,
              firstName: 'Antiguo',
              lastName: 'Afiliado Maduro',
              gender: 'MALE',
              birthDate: '1982-03-25',
              email: `antiguo_${Date.now()}@test.com`,
              mobilePhone: '+584149998877',
              planId: planRes.body.id,
            },
          ],
        });

      expect(contractRes.status).toBe(201);
      const personId = contractRes.body.contractPersons[0].personId;

      // 3. Query benefits: since 60 days have elapsed and carencia is 30 days, status MUST be COVERED
      const benefitsRes = await request(httpServer).get(`/persons/${personId}/benefits`);
      expect(benefitsRes.status).toBe(200);

      const benefitItem = benefitsRes.body.services.find(
        (s: { medicalServiceId: string }) => s.medicalServiceId === srvRes.body.id,
      );
      expect(benefitItem).toBeDefined();
      expect(benefitItem.status).toBe('COVERED');
      expect(benefitItem.isCovered).toBe(true);
      expect(benefitItem.remainingWaitingPeriodDays).toBe(0);
    });
  });
});
