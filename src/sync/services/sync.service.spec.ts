import * as xlsx from 'xlsx';
import { TypeIdentityCard } from '../../persons/entities/person.entity';
import { ContractsService } from '../../contracts/services/contracts.service';
import { GoogleDriveService } from '../../google-drive/services/google-drive.service';
import { PersonsService } from '../../persons/services/persons.service';
import { PlansService } from '../../plans/services/plans.service';
import { DataCleaned } from '../interface/data-cleaned.interface';
import { SyncService } from './sync.service';

/** Exposes SyncService private methods for testing without using `any`. */
interface SyncServicePrivate {
  cleanData(data: object[]): DataCleaned[];
  saveDataToDatabase(data: DataCleaned[]): Promise<void>;
}

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------
const mockGoogleDriveService = { downloadExcelFile: jest.fn() };
const mockPlansService = { findByName: jest.fn() };
const mockContractsService = { findByCode: jest.fn(), create: jest.fn() };
const mockPersonsService = {
  findByIdentityCard: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
const makePlan = (id = 'plan-1', name = 'Plan Basico') => ({
  id,
  name,
  amount: 100,
});

const makeContract = (id = 'contract-1', code = 'CON-001') => ({ id, code });

const makePerson = (overrides: Record<string, unknown> = {}) => {
  const overridesCopy = { ...overrides };
  let defaultContractPersons = [{ role: 'AFILIADO', contract: makeContract() }];

  if (overridesCopy.contract) {
    defaultContractPersons = [{ role: 'AFILIADO', contract: overridesCopy.contract as import('../../contracts/entities/contract.entity').Contract }];
    delete overridesCopy.contract;
  }

  return {
    id: 'person-1',
    name: 'Juan Perez',
    typeIdentityCard: TypeIdentityCard.V,
    identityCard: '26149461',
    gender: true,
    plan: makePlan(),
    contractPersons: defaultContractPersons,
    ...overridesCopy,
  };
};

/** Build a raw Excel row with the Spanish column names expected by cleanData */
const makeExcelRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  'Nombre Completo': 'Juan Perez',
  'Cédula O RIF': 'V-26149461',
  'Fecha de Afiliacion': 45292, // Excel serial → 2024-01-01
  Contrato: 'CON-001',
  Titular: true,
  Plan: 'Plan Basico',
  Genero: 'Masculino',
  ...overrides,
});

// -----------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------
describe('SyncService', () => {
  let service: SyncService;

  // Helper to create SyncService with mocked dependencies
  const makeService = (fileId: string | null = 'file-id'): SyncService =>
    new SyncService(
      mockGoogleDriveService as unknown as GoogleDriveService,
      { drive: { excelFileId: fileId } } as unknown as ConstructorParameters<typeof SyncService>[1],
      mockPlansService as unknown as PlansService,
      mockContractsService as unknown as ContractsService,
      mockPersonsService as unknown as PersonsService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();

    // Silence logger output during tests
    jest.spyOn(service['logger'], 'log').mockImplementation(() => {});
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});
    jest.spyOn(service['logger'], 'debug').mockImplementation(() => {});
    jest.spyOn(service['logger'], 'error').mockImplementation(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── handleHourlySync ──────────────────────────────────────────────────
  describe('handleHourlySync', () => {
    it('should abort and warn when excelFileId is not configured', async () => {
      // Re-create service with no fileId
      service = makeService(null);
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});
      jest.spyOn(service['logger'], 'log').mockImplementation(() => {});

      await service.handleHourlySync();

      expect(mockGoogleDriveService.downloadExcelFile).not.toHaveBeenCalled();
    });

    it('should abort and log error when Google Drive returns null buffer', async () => {
      mockGoogleDriveService.downloadExcelFile.mockResolvedValue(null);

      const errorSpy = service['logger'].error as jest.Mock;

      await service.handleHourlySync();

      expect(mockGoogleDriveService.downloadExcelFile).toHaveBeenCalledWith('file-id');
      expect(errorSpy).toHaveBeenCalledWith('Failed to retrieve file buffer from Google Drive.');
    });

    it('should parse buffer, log column names, and call saveDataToDatabase', async () => {
      // Build a minimal in-memory xlsx buffer with one data row
      const ws = xlsx.utils.aoa_to_sheet([
        [
          'Nombre Completo',
          'Cédula O RIF',
          'Fecha de Afiliacion',
          'Contrato',
          'Titular',
          'Plan',
          'Genero',
        ],
        ['Juan Perez', 'V-26149461', 45292, 'CON-001', true, 'Plan Basico', 'Masculino'],
      ]);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      mockGoogleDriveService.downloadExcelFile.mockResolvedValue(buffer);
      // Plan not found → skip (we just want to verify parsing happened)
      mockPlansService.findByName.mockResolvedValue(null);

      const debugSpy = service['logger'].debug as jest.Mock;

      await service.handleHourlySync();

      // Should have logged column names
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] Excel columns detected:'),
      );
      // Should have called the plan lookup (save path reached)
      expect(mockPlansService.findByName).toHaveBeenCalled();
    });

    it('should not log column names when the sheet is empty', async () => {
      const ws = xlsx.utils.aoa_to_sheet([]);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      mockGoogleDriveService.downloadExcelFile.mockResolvedValue(buffer);

      const debugSpy = service['logger'].debug as jest.Mock;

      await service.handleHourlySync();

      expect(debugSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] Excel columns detected:'),
      );
    });

    it('should log and continue when an Error instance fails inside row processing', async () => {
      // Provide a valid buffer so we get past the buffer null-check and into the try block
      const ws = xlsx.utils.aoa_to_sheet([
        [
          'Nombre Completo',
          'Cédula O RIF',
          'Fecha de Afiliacion',
          'Contrato',
          'Titular',
          'Plan',
          'Genero',
        ],
        ['Juan Perez', 'V-26149461', 45292, 'CON-001', true, 'Plan Basico', 'Masculino'],
      ]);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const boom = new Error('DB connection failed');
      mockGoogleDriveService.downloadExcelFile.mockResolvedValue(buffer);
      // Reject inside saveDataToDatabase; it should be handled per-row (no abort of handleHourlySync)
      mockPlansService.findByName.mockRejectedValue(boom);

      const errorSpy = service['logger'].error as jest.Mock;

      await service.handleHourlySync();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'row processing failed (incrementing skipped). DB connection failed',
        ),
      );
    });

    it('should log and continue when a non-Error fails inside row processing', async () => {
      const ws = xlsx.utils.aoa_to_sheet([
        [
          'Nombre Completo',
          'Cédula O RIF',
          'Fecha de Afiliacion',
          'Contrato',
          'Titular',
          'Plan',
          'Genero',
        ],
        ['Juan Perez', 'V-26149461', 45292, 'CON-001', true, 'Plan Basico', 'Masculino'],
      ]);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      mockGoogleDriveService.downloadExcelFile.mockResolvedValue(buffer);
      // Throw a non-Error value from inside saveDataToDatabase
      mockPlansService.findByName.mockRejectedValue('unexpected string error');

      const errorSpy = service['logger'].error as jest.Mock;

      await service.handleHourlySync();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'row processing failed (incrementing skipped). Unknown error: unexpected string error',
        ),
      );
    });
  });

  // ─── excelDateToJSDate ─────────────────────────────────────────────────
  describe('excelDateToJSDate', () => {
    it('should convert a valid Excel serial to YYYY-MM-DD', () => {
      // The exact date depends on UTC offset at midnight;
      // 45292 converts to 2024-01-01 00:00:00 UTC
      expect(service.excelDateToJSDate(45292)).toBe('2024-01-01');
    });

    it('should return null for 0', () => {
      expect(service.excelDateToJSDate(0)).toBeNull();
    });

    it('should return null for NaN', () => {
      expect(service.excelDateToJSDate(NaN)).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(service.excelDateToJSDate(undefined)).toBeNull();
    });
  });

  // ─── cleanData ─────────────────────────────────────────────────────────
  describe('cleanData', () => {
    const clean = (data: object[]) => (service as unknown as SyncServicePrivate).cleanData(data);

    it('should parse a V-type cedula correctly', () => {
      const [result] = clean([makeExcelRow()]);
      expect(result.typeIdentityCard).toBe('V');
      expect(result.identityCard).toBe('26149461');
    });

    it('should parse a J-type RIF correctly', () => {
      const [result] = clean([makeExcelRow({ 'Cédula O RIF': 'J-123456789' })]);
      expect(result.typeIdentityCard).toBe('J');
      expect(result.identityCard).toBe('123456789');
    });

    it('should default to V when there is no dash in the cedula field', () => {
      const [result] = clean([makeExcelRow({ 'Cédula O RIF': '26149461' })]);
      expect(result.typeIdentityCard).toBe('V');
      expect(result.identityCard).toBe('26149461');
    });

    it('should map "Masculino" to gender true', () => {
      const [result] = clean([makeExcelRow({ Genero: 'Masculino' })]);
      expect(result.gender).toBe(true);
    });

    it('should map any other gender value to false', () => {
      const [result] = clean([makeExcelRow({ Genero: 'Femenino' })]);
      expect(result.gender).toBe(false);
    });

    it('should filter out rows with an empty Nombre Completo', () => {
      const rows = [
        makeExcelRow(),
        makeExcelRow({ 'Nombre Completo': '' }),
        makeExcelRow({ 'Nombre Completo': '   ' }),
        makeExcelRow({ 'Nombre Completo': null }),
      ];
      expect(clean(rows)).toHaveLength(1);
    });

    it('should trim whitespace from name and contract', () => {
      const [result] = clean([
        makeExcelRow({ 'Nombre Completo': '  Juan Perez  ', Contrato: '  CON-001  ' }),
      ]);
      expect(result.name).toBe('Juan Perez');
      expect(result.contract).toBe('CON-001');
    });

    it('should set contract to empty string when Contrato is falsy', () => {
      const [result] = clean([makeExcelRow({ Contrato: null })]);
      expect(result.contract).toBe('');
    });

    it('should convert the Excel date serial to an ISO date string', () => {
      const [result] = clean([makeExcelRow({ 'Fecha de Afiliacion': 45292 })]);
      expect(result.affiliationDate).toBe('2024-01-01');
    });

    it('should return an empty array for empty input', () => {
      expect(clean([])).toEqual([]);
    });
  });

  // ─── saveDataToDatabase ────────────────────────────────────────────────
  describe('saveDataToDatabase', () => {
    const save = (data: DataCleaned[]) =>
      (service as unknown as SyncServicePrivate).saveDataToDatabase(data);

    const baseItem = {
      name: 'Juan Perez',
      typeIdentityCard: TypeIdentityCard.V,
      identityCard: '26149461',
      affiliationDate: '2024-01-01',
      contract: 'CON-001',
      isTitular: true,
      plan: 'Plan Basico',
      gender: true,
      rowNumber: 2,
    };

    it('should skip the record when the plan is not found', async () => {
      mockPlansService.findByName.mockResolvedValue(null);

      await save([baseItem]);

      expect(mockPlansService.findByName).toHaveBeenCalledWith('Plan Basico');
      expect(mockContractsService.findByCode).not.toHaveBeenCalled();
      expect(mockPersonsService.create).not.toHaveBeenCalled();
    });

    it('should skip the record when contract code is empty', async () => {
      mockPlansService.findByName.mockResolvedValue(makePlan());

      await save([{ ...baseItem, contract: '' }]);

      expect(mockContractsService.findByCode).not.toHaveBeenCalled();
      expect(mockPersonsService.create).not.toHaveBeenCalled();
    });

    it('should skip the record when affiliation date is empty', async () => {
      mockPlansService.findByName.mockResolvedValue(makePlan());

      await save([{ ...baseItem, affiliationDate: '' }]);

      expect(mockContractsService.findByCode).not.toHaveBeenCalled();
      expect(mockPersonsService.create).not.toHaveBeenCalled();
    });

    it('should create a new contract when none exists for that code', async () => {
      mockPlansService.findByName.mockResolvedValue(makePlan());
      mockContractsService.findByCode.mockResolvedValue(null);
      mockContractsService.create.mockResolvedValue(makeContract());
      mockPersonsService.findByIdentityCard.mockResolvedValue(null);
      mockPersonsService.create.mockResolvedValue({});

      await save([baseItem]);

      expect(mockContractsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'CON-001' }),
      );
    });

    it('should create a new person when findByIdentityCard returns null', async () => {
      mockPlansService.findByName.mockResolvedValue(makePlan());
      mockContractsService.findByCode.mockResolvedValue(makeContract());
      mockPersonsService.findByIdentityCard.mockResolvedValue(null);
      mockPersonsService.create.mockResolvedValue({});

      await save([baseItem]);

      expect(mockPersonsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Juan Perez',
          typeIdentityCard: TypeIdentityCard.V,
          identityCard: '26149461',
        }),
      );
      expect(mockPersonsService.update).not.toHaveBeenCalled();
    });

    it('should update an existing person when a field has changed', async () => {
      const plan = makePlan('plan-1');
      const contract = makeContract('contract-1');
      const existingPerson = makePerson({ name: 'Old Name', plan, contract });

      mockPlansService.findByName.mockResolvedValue(plan);
      mockContractsService.findByCode.mockResolvedValue(contract);
      mockPersonsService.findByIdentityCard.mockResolvedValue(existingPerson);
      mockPersonsService.update.mockResolvedValue({});

      await save([{ ...baseItem, name: 'New Name' }]);

      expect(mockPersonsService.update).toHaveBeenCalledWith(
        existingPerson.id,
        expect.objectContaining({ name: 'New Name' }),
      );
      expect(mockPersonsService.create).not.toHaveBeenCalled();
    });

    it('should skip update when existing person has no changes', async () => {
      const plan = makePlan('plan-1');
      const contract = makeContract('contract-1');
      const existingPerson = makePerson({ name: 'Juan Perez', gender: true, plan, contract });

      mockPlansService.findByName.mockResolvedValue(plan);
      mockContractsService.findByCode.mockResolvedValue(contract);
      mockPersonsService.findByIdentityCard.mockResolvedValue(existingPerson);

      await save([baseItem]);

      expect(mockPersonsService.update).not.toHaveBeenCalled();
      expect(mockPersonsService.create).not.toHaveBeenCalled();
    });

    it('should report correct Created / Updated / Skipped counts in the summary log', async () => {
      const plan = makePlan('plan-1');
      const contract = makeContract('contract-1');

      // Record 1 → new person (create)
      // Record 2 → plan not found (skip)
      // Record 3 → existing person, no changes (no update)
      const existingPerson = makePerson({ name: 'Maria Lopez', gender: false, plan, contract });

      mockPlansService.findByName
        .mockResolvedValueOnce(plan) // record 1
        .mockResolvedValueOnce(null) // record 2
        .mockResolvedValueOnce(plan); // record 3

      mockContractsService.findByCode.mockResolvedValue(contract);

      mockPersonsService.findByIdentityCard
        .mockResolvedValueOnce(null) // record 1 — new
        .mockResolvedValueOnce(existingPerson); // record 3 — no changes

      mockPersonsService.create.mockResolvedValue({});

      const logSpy = service['logger'].log as jest.Mock;

      await save([
        { ...baseItem, name: 'Juan Perez', identityCard: '11111111' }, // create
        { ...baseItem, plan: 'Plan Inexistente' }, // skip
        { ...baseItem, name: 'Maria Lopez', identityCard: '22222222', gender: false }, // no-op
      ]);

      const summary = logSpy.mock.calls.find((args) =>
        String(args[0]).includes('Sync complete'),
      )?.[0];

      expect(summary).toContain('Created: 1');
      expect(summary).toContain('Updated: 0');
      expect(summary).toContain('Skipped: 1');
    });
  });
});
