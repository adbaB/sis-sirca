import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as xlsx from 'xlsx';

import { AdvisorsService } from '../../advisors/advisors.service';
import config from '../../config/configurations';
import { PersonRole } from '../../contracts/entities/contract-person.entity';
import { ContractsService } from '../../contracts/services/contracts.service';
import { GoogleDriveService } from '../../google/services/google-drive.service';
import { PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { PersonsService } from '../../persons/services/persons.service';
import { PlansService } from '../../plans/services/plans.service';
import { DataCleaned } from '../interface/data-cleaned.interface';
import { excelDateToDateString } from '../../common/utils/date.util';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly VALID_TYPE_IDENTITY_CARDS = Object.values(TypeIdentityCard);
  constructor(
    private readonly googleDriveService: GoogleDriveService,
    @Inject(config.KEY)
    private configService: ConfigType<typeof config>,
    private readonly plansService: PlansService,
    private readonly contractsService: ContractsService,
    private readonly personsService: PersonsService,
    private readonly advisorsService: AdvisorsService,
  ) {}

  // DEPRECATED - This method is no longer scheduled to run automatically. It can be triggered manually if needed for one-off syncs, but the preferred approach is to use the new CLI command for better control and observability.
  async handleHourlySync() {
    this.logger.log('Starting hourly Excel sync...');

    const fileId = this.configService.google.excelFileId;
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
      .map((item, idx) => {
        const rowNumber = idx + 2; // +2 to account for header row + 0-index
        const row = item as Record<string, unknown>;

        // Normalize once per field to avoid failures with numeric/date-formatted cells.
        // Also prevent introducing whitespace that causes false "[SKIP]" outcomes in lookups.
        const name = String(row['Nombre Completo'] ?? '').trim();
        const cedulaOrRif = String(row['Cédula O RIF'] ?? '').trim();

        const affiliationRaw = row['Fecha de Afiliacion'];
        const affiliationDate = this.excelDateToJSDate(
          typeof affiliationRaw === 'number' ? affiliationRaw : Number(affiliationRaw),
        );

        const contract = String(row['Contrato'] ?? '').trim();
        const plan = String(row['Plan'] ?? '').trim();

        const rawTitular = row['¿Es Titular?'];
        const isTitular = rawTitular === 0 || rawTitular === '0';

        const generoRaw = row['Genero'];
        const gender = generoRaw === 'Masculino' || String(generoRaw ?? '').trim() === 'Masculino';

        const rawIsBillingOwner = row['¿Es Titular de la Factura?'];
        const isBillingOwner = rawIsBillingOwner === 1 || rawIsBillingOwner === '1';

        const rawStatus = row['Estado'];
        const status =
          rawStatus === 1 || rawStatus === '1' ? PersonStatus.ACTIVE : PersonStatus.INACTIVE;

        const advisor = String(row['Asesor'] ?? '').trim();

        let typeIdentityCardStr = 'V';
        let identityCardNum = cedulaOrRif;

        if (cedulaOrRif.includes('-')) {
          const parts = cedulaOrRif.split('-').map((p) => p.trim());
          typeIdentityCardStr = parts[0].toUpperCase();
          identityCardNum = parts.slice(1).join('-');
        }

        const typeIdentityCard = this.VALID_TYPE_IDENTITY_CARDS.includes(
          typeIdentityCardStr as TypeIdentityCard,
        )
          ? (typeIdentityCardStr as TypeIdentityCard)
          : TypeIdentityCard.V;

        return {
          name,
          typeIdentityCard: typeIdentityCard,
          identityCard: identityCardNum,
          affiliationDate,
          contract,
          isTitular,
          plan,
          gender,
          isBillingOwner,
          status,
          advisor,
          rowNumber,
        };
      })
      .filter((row) => row.name !== '');
  }

  private maskIdentityCard(typeIdentityCard: string, identityCard: string): string {
    const normalized = String(identityCard ?? '').trim();
    if (!normalized) return '-';

    const cleaned = normalized.replace(/[^a-zA-Z0-9]/g, '');
    if (cleaned.length < 4) return `${typeIdentityCard}-****`;

    const last4 = cleaned.slice(-4);
    return `${typeIdentityCard}-****${last4}`;
  }

  private getRowLogContext(item: DataCleaned): string {
    const contract = item.contract ? item.contract : '-';
    const maskedId = this.maskIdentityCard(item.typeIdentityCard, item.identityCard);
    return `fila=${item.rowNumber} contrato="${contract}" id="${maskedId}"`;
  }

  excelDateToJSDate(serial: number): string | null {
    return excelDateToDateString(serial);
  }

  private async saveDataToDatabase(data: DataCleaned[]): Promise<void> {
    this.logger.log(`Starting database sync for ${data.length} records...`);
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const item of data) {
      try {
        const rowContext = this.getRowLogContext(item);

        // Verify plan exists
        const plan = await this.plansService.findByName(item.plan);
        if (!plan) {
          this.logger.warn(`[SKIP] ${rowContext}: plan "${item.plan}" not found.`);
          skipped++;
          continue;
        }

        // Verify contract exists or create a new one
        if (!item.contract) {
          this.logger.warn(`[SKIP] fila=${item.rowNumber}: missing contract code.`);
          skipped++;
          continue;
        }

        if (!item.affiliationDate) {
          this.logger.warn(`[SKIP] ${rowContext}: missing affiliation date for contract.`);
          skipped++;
          continue;
        }

        // Resolve advisor by name (null if not found or name is empty)
        const advisor = item.advisor ? await this.advisorsService.findByName(item.advisor) : null;
        if (item.advisor && !advisor) {
          this.logger.warn(
            `[ADVISOR] ${rowContext}: advisor "${item.advisor}" not found in database. Contract will be saved without advisor.`,
          );
        }

        let contract = await this.contractsService.findByCode(item.contract);
        if (!contract) {
          this.logger.log(
            `[CONTRACT] Creating new contract with code "${item.contract}" (fila=${item.rowNumber}).`,
          );
          contract = await this.contractsService.create({
            legacyCode: item.contract,
            affiliationDate: item.affiliationDate,
            advisorId: advisor ? advisor.id : '00000000-0000-0000-0000-000000000000', // Use a dummy UUID or let the service fail if advisor is strictly required
          });
        } else {
          // Update advisor on existing contract if it changed
          const currentAdvisorId =
            (contract.advisor as { id: string } | null | undefined)?.id ?? null;
          const newAdvisorId = advisor?.id ?? null;
          if (currentAdvisorId !== newAdvisorId) {
            await this.contractsService.setAdvisor(contract.id, newAdvisorId);
          }
        }

        // Verify person — update if exists, create if not
        const person = await this.personsService.findByIdentityCard(
          item.identityCard,
          item.typeIdentityCard,
        );

        if (person) {
          const expectedRole = item.isTitular ? PersonRole.TITULAR : PersonRole.AFILIADO;
          // Find the ContractPerson record for this specific contract
          const existingContractPerson = person.contractPersons?.find(
            (cp) => cp.contract?.id === contract.id,
          );
          // Check if person is already linked to this contract with the expected role
          const isLinkedToContract =
            !!existingContractPerson && existingContractPerson.role === expectedRole;

          // Don't trigger an update strictly for a plan mismatch if they are a Titular,
          // because persons.service.ts correctly ignores plan changes for Titulares anyway.
          const planMismatch = item.isTitular ? false : person.plan?.id !== plan.id;

          const billingOwnerChanged =
            existingContractPerson?.isBillingOwner !== item.isBillingOwner;

          const hasChanges =
            person.name !== item.name ||
            planMismatch ||
            !isLinkedToContract ||
            person.gender !== item.gender ||
            person.status !== item.status ||
            billingOwnerChanged;

          if (!hasChanges) {
            continue;
          }

          await this.personsService.update(person.id, {
            name: item.name,
            planId: plan.id,
            contractId: contract.id,
            gender: item.gender,
            role: item.isTitular ? PersonRole.TITULAR : PersonRole.AFILIADO,
            isBillingOwner: item.isBillingOwner,
            status: item.status,
          });
          updated++;
        } else {
          this.logger.log(`[PERSON] ${rowContext}: creating new person.`);
          await this.personsService.create({
            name: item.name,
            typeIdentityCard: item.typeIdentityCard,
            identityCard: item.identityCard,
            planId: plan.id,
            contractId: contract.id,
            gender: item.gender,
            role: item.isTitular ? PersonRole.TITULAR : PersonRole.AFILIADO,
            isBillingOwner: item.isBillingOwner,
            status: item.status,
          });
          created++;
        }
      } catch (error) {
        skipped++;
        const message = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
        this.logger.error(
          `[ERROR] ${this.getRowLogContext(item)}: row processing failed (incrementing skipped). ${message}`,
        );
      }
    }

    this.logger.log(
      `Sync complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}.`,
    );
  }
}
