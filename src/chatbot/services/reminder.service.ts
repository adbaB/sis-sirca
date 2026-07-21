import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MetaWhatsappService } from './meta-whatsapp.service';
import { WHATSAPP_TEMPLATES } from '../constants/whatsapp-templates.contants';
import { MONTH_NAMES_ES } from '../../reports/report-utils';
import { BillingService } from '../../billing/services/billing.service';
import { Person } from '../../persons/entities/person.entity';
import { Invoice } from '../../billing/invoices/entities/invoice.entity';
import { getBillingMonth } from '../../common/utils/date.util';

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
    private readonly billingService: BillingService,
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
    try {
      const debts = await this.getPersonsWithPendingInvoices();
      this.logger.log(`Enviando "${templateName}" a ${debts.length} personas.`);

      for (const debt of debts) {
        // 1. Validaciones de seguridad
        if (!debt.person.phone || !debt.person.phone.startsWith('+')) continue;

        const unpaidInvoices = debt.invoices.filter(
          (inv) => Number(inv.paidAmount) < Number(inv.totalAmount),
        );
        if (unpaidInvoices.length === 0) continue;

        try {
          // 2. 🎯 MAGIA: Ejecutamos la función específica que creamos en cada Cron Job
          const templateVariables = variablesMapper(debt.person, unpaidInvoices);

          // 3. Enviamos a Meta
          await this.whatsappService.sendTemplateMessage(
            debt.person.phone,
            templateName,
            templateVariables,
            'en',
            `REMINDER_${debt.person.id}`,
          );

          this.logger.log(`Plantilla enviada a ${debt.person.phone}`);
        } catch (error) {
          this.logger.error(`Error enviando a ${debt.person.phone}:`, error?.message);
        }

        // 4. Pausa para evitar bans de Meta
        await this.sleep(500);
      }
    } catch (error) {
      this.logger.error('Error crítico en el proceso de recordatorios:', error);
    }
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
      await this.billingService.findPendingInvoicesByBillingMonth(getBillingMonth());

    // Agrupamos las facturas por persona
    const debtsMap = new Map<string, PendingDebt>();

    for (const invoice of pendingInvoices) {
      const person = invoice.contract?.contractPersons.find(
        (contractPerson) => contractPerson.isBillingOwner,
      ).person;
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
