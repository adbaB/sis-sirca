import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PdfService } from '../../pdf/services/pdf.service';
import { getGeneratedAtTimestamp, loadLogoBase64 } from '../../reports/report-utils';
import { Plan, PlanStatus } from '../entities/plan.entity';
import { PlanService } from '../entities/plan-service.entity';

export interface FormattedPlanServiceRow {
  serviceName: string;
  waitingPeriodDays: number;
  isImmediate: boolean;
  waitingPeriodText: string;
}

export interface PairedPlanServiceRow {
  left: FormattedPlanServiceRow;
  right: FormattedPlanServiceRow | null;
}

export interface PlanCategoryGroup {
  categoryId: string;
  categoryName: string;
  servicesCount: number;
  pairedRows: PairedPlanServiceRow[];
}

export interface PlanPdfTemplateData extends Record<string, unknown> {
  logo: string;
  planName: string;
  monthlyAmount: string;
  coverage: string;
  ageRange: string;
  statusText: string;
  categoryGroups: PlanCategoryGroup[];
  totalServices: number;
  generatedAt: string;
}

@Injectable()
export class PlanPdfService {
  private readonly logger = new Logger(PlanPdfService.name);

  constructor(
    @InjectRepository(Plan)
    private readonly plansRepository: Repository<Plan>,
    @InjectRepository(PlanService)
    private readonly planServicesRepository: Repository<PlanService>,
    private readonly pdfService: PdfService,
  ) {}

  /**
   * Genera el PDF del plan en orientación horizontal con los servicios agrupados por categoría
   * @param planId ID del plan
   * @returns Búfer del PDF y nombre del archivo
   */
  async generatePlanPdf(planId: string): Promise<{ pdfBuffer: Buffer; filename: string }> {
    const plan = await this.plansRepository.findOne({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID "${planId}" not found`);
    }

    const planServices = await this.planServicesRepository.find({
      where: { planId },
      relations: {
        medicalService: {
          category: true,
        },
      },
    });

    const logo = await loadLogoBase64(this.logger);
    const generatedAt = getGeneratedAtTimestamp();

    const formatCurrency = (val: number | string): string => {
      const num = Number(val || 0);
      return `$${new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(num)}`;
    };

    const minAgeText =
      plan.minMonths && plan.minMonths > 0 ? `${plan.minMonths} meses` : `${plan.minAge ?? 0} años`;
    const ageRange = `Desde ${minAgeText} hasta ${plan.maxAge} años`;

    // Agrupar servicios médicos por categoría
    const categoryMap = new Map<
      string,
      { categoryId: string; categoryName: string; services: FormattedPlanServiceRow[] }
    >();

    for (const ps of planServices) {
      const categoryId = ps.medicalService?.category?.id || 'general';
      const categoryName = ps.medicalService?.category?.name || 'General';
      const serviceName = ps.medicalService?.name || 'Servicio no especificado';
      const waitingPeriodDays = Number(ps.waitingPeriodDays || 0);
      const isImmediate = waitingPeriodDays === 0;
      const waitingPeriodText = isImmediate
        ? 'Inmediato'
        : `${waitingPeriodDays} día${waitingPeriodDays === 1 ? '' : 's'}`;

      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, {
          categoryId,
          categoryName,
          services: [],
        });
      }

      categoryMap.get(categoryId)!.services.push({
        serviceName,
        waitingPeriodDays,
        isImmediate,
        waitingPeriodText,
      });
    }

    // Ordenar categorías alfabéticamente y emparejar los servicios dentro de cada categoría
    const categoryGroups: PlanCategoryGroup[] = Array.from(categoryMap.values())
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'es', { sensitivity: 'base' }))
      .map((cat) => {
        // Ordenar servicios alfabéticamente dentro de la categoría
        cat.services.sort((a, b) =>
          a.serviceName.localeCompare(b.serviceName, 'es', { sensitivity: 'base' }),
        );

        // Emparejar a doble columna dentro de la categoría
        const pairedRows: PairedPlanServiceRow[] = [];
        for (let i = 0; i < cat.services.length; i += 2) {
          pairedRows.push({
            left: cat.services[i],
            right: cat.services[i + 1] ?? null,
          });
        }

        return {
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          servicesCount: cat.services.length,
          pairedRows,
        };
      });

    const templateData: PlanPdfTemplateData = {
      logo,
      planName: plan.name,
      monthlyAmount: formatCurrency(plan.amount),
      coverage: formatCurrency(plan.coverage),
      ageRange,
      statusText: plan.status === PlanStatus.ACTIVE ? 'Activo' : 'Inactivo',
      categoryGroups,
      totalServices: planServices.length,
      generatedAt,
    };

    const pdfBuffer = await this.pdfService.generatePdf('plan-details', templateData, {
      landscape: true,
    });

    const sanitizedPlanName = plan.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const filename = `plan-${sanitizedPlanName || plan.id}.pdf`;

    return { pdfBuffer, filename };
  }
}
