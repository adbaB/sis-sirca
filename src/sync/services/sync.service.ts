import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as xlsx from 'xlsx';

import config from '../../config/configurations';
import { ContractsService } from '../../contracts/services/contracts.service';
import { GoogleDriveService } from '../../google-drive/services/google-drive.service';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { PlansService } from '../../plans/services/plans.service';
import { DataCleaned } from '../interface/data-cleaned.interface';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly googleDriveService: GoogleDriveService,
    @Inject(config.KEY)
    private configService: ConfigType<typeof config>,
    private readonly plansService: PlansService,
    private readonly contractsService: ContractsService,
    private readonly personsService: PersonsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlySync() {
    this.logger.log('Starting hourly Excel sync...');

    const fileId = this.configService.drive.excelFileId;
    if (!fileId) {
      this.logger.warn('GOOGLE_DRIVE_EXCEL_FILE_ID is not configured. Aborting sync.');
      return;
    }

    const buffer = await this.googleDriveService.downloadExcelFile(fileId);
    if (!buffer) {
      this.logger.error('Failed to retrieve file buffer from Google Drive.');
      return;
    }

    try {
      // Parse the buffer using xlsx
      this.logger.log('Parsing Excel buffer...');
      const workbook = xlsx.read(buffer, { type: 'buffer' });

      const sheetName = workbook.SheetNames[0]; // Assuming data is on the first sheet
      const worksheet = workbook.Sheets[sheetName];

      const jsonData = xlsx.utils.sheet_to_json(worksheet);

      this.logger.log(`Successfully parsed ${jsonData.length} rows from Excel.`);

      if (jsonData.length > 0) {
        this.logger.debug(
          `[DEBUG] Excel columns detected: ${Object.keys(jsonData[0] as object).join(' | ')}`,
        );
      }

      const cleanedData = this.cleanData(jsonData as object[]);
      this.logger.log(`Cleaned data: ${cleanedData.length} valid records after filtering.`);

      await this.saveDataToDatabase(cleanedData);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Error parsing Excel file: ${error.message}`, error.stack);
      } else {
        this.logger.error('Error parsing Excel file: Unknown error', String(error));
      }
    }
  }

  private cleanData(data: object[]): DataCleaned[] {
    return data
      .filter((item) => item['Nombre Completo'] && item['Nombre Completo'].trim() !== '')
      .map((item) => {
        const cedulaOrRif = item['Cédula O RIF'] ? String(item['Cédula O RIF']).trim() : '';
        let typeIdentityCardStr = 'V';
        let identityCardNum = cedulaOrRif;

        if (cedulaOrRif.includes('-')) {
          const parts = cedulaOrRif.split('-');
          typeIdentityCardStr = parts[0].toUpperCase();
          identityCardNum = parts.slice(1).join('-');
        }

        return {
          name: item['Nombre Completo'].trim(),
          typeIdentityCard: typeIdentityCardStr as TypeIdentityCard,
          identityCard: identityCardNum,
          affiliationDate: this.excelDateToJSDate(item['Fecha de Afiliacion']),
          contract: item['Contrato'] ? String(item['Contrato']).trim() : '',
          isTitular: item['Titular'] || false,
          plan: item['Plan'],
          gender: item['Genero'] === 'Masculino' ? true : false,
        };
      });
  }

  excelDateToJSDate(serial: number): string | null {
    if (!serial || isNaN(serial)) return null;
    const date = new Date((serial - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0]; // Retorna YYYY-MM-DD
  }

  private async saveDataToDatabase(data: DataCleaned[]): Promise<void> {
    this.logger.log(`Starting database sync for ${data.length} records...`);
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of data) {
      // Verify plan exists
      const plan = await this.plansService.findByName(item.plan);
      if (!plan) {
        this.logger.warn(
          `[SKIP] Plan "${item.plan}" not found for person "${item.name}" (${item.typeIdentityCard}-${item.identityCard}).`,
        );
        skipped++;
        continue;
      }

      // Verify contract exists or create a new one
      if (!item.contract) {
        this.logger.warn(
          `[SKIP] No contract code for person "${item.name}" (${item.typeIdentityCard}-${item.identityCard}).`,
        );
        skipped++;
        continue;
      }

      let contract = await this.contractsService.findByCode(item.contract);
      if (!contract) {
        this.logger.log(`[CONTRACT] Creating new contract with code "${item.contract}".`);
        contract = await this.contractsService.create({
          code: item.contract,
          affiliationDate: item.affiliationDate,
        });
      }

      // Verify person — update if exists, create if not
      let person = null;
      try {
        person = await this.personsService.findByIdentityCard(
          item.identityCard,
          item.typeIdentityCard,
        );
      } catch {
        // Person not found — will be created below
      }

      if (person) {
        const hasChanges =
          person.name !== item.name ||
          person.plan?.id !== plan.id ||
          person.contract?.id !== contract.id ||
          person.gender !== item.gender;

        if (!hasChanges) {
          continue;
        }

        await this.personsService.update(person.id, {
          name: item.name,
          planId: plan.id,
          contractId: contract.id,
          gender: item.gender,
        });
        updated++;
      } else {
        this.logger.log(
          `[PERSON] Creating new person "${item.name}" (${item.typeIdentityCard}-${item.identityCard}).`,
        );
        await this.personsService.create({
          name: item.name,
          typeIdentityCard: item.typeIdentityCard,
          identityCard: item.identityCard,
          planId: plan.id,
          contractId: contract.id,
          gender: item.gender,
        });
        created++;
      }
    }

    this.logger.log(
      `Sync complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}.`,
    );
  }
}
