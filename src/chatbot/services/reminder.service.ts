import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigType } from '@nestjs/config';
import axios from 'axios';
import config from '../../config/configurations';
import { MetaWhatsappService } from './meta-whatsapp.service';
import { ChatbotStateService } from './chatbot-state.service';
import { WHATSAPP_TEMPLATES } from '../constants/whatsapp-templates.contants';
import { MONTH_NAMES_ES } from '../../reports/report-utils';
import { Steps } from '../enums/steps.enum';
import { Person } from '../../persons/entities/person.entity';
import { Invoice } from '../../billing/invoices/entities/invoice.entity';
import { getBillingMonth } from '../../common/utils/date.util';
import { InvoiceService } from '../../billing/invoices/services/invoice.service';
import { normalizeWhatsappPhone } from '../utils/phone.util';

// Interfaz temporal para agrupar los datos
interface PendingDebt {
  person: Person;
  invoices: Invoice[];
}

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly whatsappService: MetaWhatsappService,
    private readonly invoiceService: InvoiceService,
    private readonly stateService: ChatbotStateService,
    @Inject(config.KEY) private readonly configService: ConfigType<typeof config>,
  ) {}

  // 🎯 DÍA 25: Plantilla con 2 variables (Ej: Nombre y Monto)
  @Cron('0 14 25 * *', { name: 'Reminder Day 25', timeZone: 'America/Caracas' })
  async handleDay25Reminder() {
    this.logger.log('Iniciando recordatorio del día 25');

    const mapVars = (person: Person, invoices: Invoice[]) => {
      const total = this.calculateTotal(invoices);
      const dueDate = this.getDueDateMonth(invoices);

      return {
        nombre: this.capitalizeAllWords(person.name) || 'Cliente',
        monto: `${total.toFixed(2)}$`,
        mes: dueDate,
      };
    };

    await this.processReminders(WHATSAPP_TEMPLATES.REMINDER_DAY_25, mapVars);
  }

  // 🎯 DÍA 3: Plantilla con 4 variables (Ej: Nombre, Cantidad, Monto, Fecha límite)
  @Cron('0 16 3 * *', { name: 'Reminder Day 3', timeZone: 'America/Caracas' })
  async handleDay3Reminder() {
    this.logger.log('Iniciando recordatorio del día 3');

    const mapVars = (person: Person, invoices: Invoice[]): Record<string, string> => {
      const total = this.calculateTotal(invoices);
      const dueDate = this.getDueDateMonth(invoices);

      return {
        nombre: this.capitalizeAllWords(person.name) || 'Cliente',
        monto: `${total.toFixed(2)}$`,
        mes: dueDate,
      };
    };

    await this.processReminders(WHATSAPP_TEMPLATES.REMINDER_DAY_3, mapVars);
  }

  // 🎯 DÍA 5: Plantilla con 3 variables (Ej: Nombre, Monto, Consecuencia)
  @Cron('0 10 5 * *', { name: 'Reminder Day 5', timeZone: 'America/Caracas' })
  async handleDay5Reminder() {
    this.logger.log('Iniciando recordatorio del día 5 (Urgente)');

    const mapVars = (person: Person, invoices: Invoice[]) => {
      const total = this.calculateTotal(invoices);
      const dueDate = this.getDueDateMonth(invoices);

      return {
        nombre: this.capitalizeAllWords(person.name) || 'Cliente',
        monto: `${total.toFixed(2)}$`,
        mes: dueDate,
      };
    };

    await this.processReminders(WHATSAPP_TEMPLATES.REMINDER_DAY_5, mapVars);
  }

  /**
   * MOTOR GENÉRICO: Se encarga de la lógica pesada (BD, pausas, validaciones)
   * pero delega el formato de las variables a la función que recibe.
   */
  private async processReminders(
    templateName: string,
    variablesMapper: (person: Person, invoices: Invoice[]) => Record<string, string>,
  ): Promise<void> {
    const templateLang = this.configService.meta.templateLanguage || 'es';
    try {
      const debts = await this.getPersonsWithPendingInvoices();
      this.logger.log(
        `[Reminder] Iniciando envío de plantilla "${templateName}" (${templateLang}) para ${debts.length} personas con deuda pendiente.`,
      );

      let successCount = 0;
      let failCount = 0;
      let skippedCount = 0;

      for (const debt of debts) {
        const rawPhone = debt.person?.phone;
        const normalizedPhone = normalizeWhatsappPhone(rawPhone);

        // 1. Validaciones de teléfono
        if (!normalizedPhone) {
          this.logger.warn(
            `[Reminder] Omitiendo a persona ${debt.person?.id}: teléfono inválido o no reconocido.`,
          );
          skippedCount++;
          continue;
        }

        const unpaidInvoices = debt.invoices.filter(
          (inv) => Number(inv.paidAmount) < Number(inv.totalAmount),
        );
        if (unpaidInvoices.length === 0) {
          this.logger.debug(
            `[Reminder] Omitiendo a persona ${debt.person?.id} (${this.maskPhone(normalizedPhone)}): no posee facturas con saldo pendiente.`,
          );
          skippedCount++;
          continue;
        }

        try {
          // 2. Mapeo de variables según el Cron Job
          const templateVariables = variablesMapper(debt.person, unpaidInvoices);

          this.logger.log(
            `[Reminder] Enviando "${templateName}" a persona ${debt.person.id} (${this.maskPhone(normalizedPhone)}).`,
          );

          // 3. Enviamos a Meta
          await this.whatsappService.sendTemplateMessage(
            normalizedPhone,
            templateName,
            templateVariables,
            templateLang,
            `REMINDER_${debt.person.id}`,
          );

          // Pre-set state so the chatbot knows a Flow response is expected
          await this.stateService.setState(normalizedPhone, {
            step: Steps.AWAITING_FLOW_INTERACTION,
          });

          successCount++;
          this.logger.log(
            `[Reminder] Plantilla "${templateName}" enviada a persona ${debt.person.id} (${this.maskPhone(normalizedPhone)}).`,
          );
        } catch (error: unknown) {
          failCount++;
          let errorDetails = '';
          if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const data = error.response?.data;
            const dataStr = data
              ? typeof data === 'object'
                ? JSON.stringify(data)
                : String(data)
              : error.message;
            errorDetails = `[HTTP ${status ?? 'N/A'}] ${dataStr}`;
          } else if (error instanceof Error) {
            errorDetails = error.message;
          } else {
            errorDetails = String(error);
          }

          this.logger.error(
            `[Reminder] Error enviando recordatorio a persona ${debt.person?.id} (${this.maskPhone(normalizedPhone)}) [plantilla: "${templateName}", idioma: "${templateLang}"]: ${errorDetails}`,
            error instanceof Error ? error.stack : undefined,
          );
        }

        // 4. Pausa para evitar bans / rate limits de Meta
        await this.sleep(500);
      }

      this.logger.log(
        `[Reminder] Proceso finalizado para "${templateName}". Resumen -> Total: ${debts.length}, Enviados: ${successCount}, Fallidos: ${failCount}, Omitidos: ${skippedCount}`,
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Reminder] Error crítico en el proceso de recordatorios ("${templateName}"): ${errorMsg}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Enmascara el teléfono para logs (deja solo los últimos 4 dígitos). */
  private maskPhone(phone: string): string {
    return phone.length > 4 ? `***${phone.slice(-4)}` : '***';
  }

  // Helper para extraer el mes de vencimiento
  private getDueDateMonth(invoices: Invoice[]): string {
    const targetInvoice = invoices[0];
    return targetInvoice ? this.getMonthName(targetInvoice.billingMonth) : 'mes actual';
  }

  // Helper para no repetir la suma
  private calculateTotal(invoices: Invoice[]): number {
    return invoices.reduce(
      (sum, inv) => sum + (Number(inv.totalAmount) - Number(inv.paidAmount)),
      0,
    );
  }

  // Helper para extraer el mes en español del billingMonth (ej: "2026-07" -> "julio")
  private getMonthName(billingMonth: string): string {
    if (!billingMonth) return 'mes actual';
    const parts = billingMonth.split('-');
    if (parts.length >= 2) {
      const monthIndex = parseInt(parts[1], 10) - 1;
      if (monthIndex >= 0 && monthIndex <= 11) {
        return MONTH_NAMES_ES[monthIndex];
      }
    }
    return 'mes actual';
  }

  /**
   * Query a la base de datos para obtener quiénes deben y qué deben.
   * NOTA: Ajusta los nombres de las relaciones (contract, person) según tu schema real.
   */
  private async getPersonsWithPendingInvoices(): Promise<PendingDebt[]> {
    // Obtenemos todas las facturas que están pendientes
    const pendingInvoices =
      await this.invoiceService.findPendingInvoicesByBillingMonth(getBillingMonth());

    // Agrupamos las facturas por persona
    const debtsMap = new Map<string, PendingDebt>();

    for (const invoice of pendingInvoices) {
      const person = invoice.contract?.contractPersons.find(
        (contractPerson) => contractPerson.isBillingOwner,
      )?.person;
      if (!person) continue;

      if (!debtsMap.has(person.id)) {
        debtsMap.set(person.id, { person, invoices: [] });
      }
      debtsMap.get(person.id).invoices.push(invoice);
    }

    return Array.from(debtsMap.values());
  }

  // Helper para hacer el código async más legible
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private capitalizeAllWords(str: string) {
    if (!str) return str;

    return str
      .split(' ') // Separa la frase por espacios
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitaliza cada palabra
      .join(' '); // Vuelve a unir la frase con espacios
  }
}
