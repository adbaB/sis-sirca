import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import {
  applyDataCellStyle,
  applyGrandTotalStyle,
  applySectionHeaderStyle,
  applySubtotalCellStyle,
  applyTableHeaderStyle,
  applyTitleRowStyle,
  createWorkbook,
  fetchAdvisorName,
  finishWorkbook,
  formatDateES,
  getGeneratedAtTimestamp,
  thinBorder,
} from './report-utils';

describe('Report Utils', () => {
  describe('formatDateES', () => {
    it('should format JS Date objects to dd-MM-yyyy Venezuelan format', () => {
      const date = new Date('2026-06-15T12:00:00');
      const formatted = formatDateES(date);
      expect(formatted).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    });

    it('should format ISO date strings to dd-MM-yyyy Venezuelan format', () => {
      const formatted = formatDateES('2026-06-15');
      expect(formatted).toBe('15-06-2026');
    });
  });

  describe('getGeneratedAtTimestamp', () => {
    it('should return a string containing the current date/time', () => {
      const timestamp = getGeneratedAtTimestamp();
      expect(typeof timestamp).toBe('string');
      expect(timestamp.length).toBeGreaterThan(0);
    });
  });

  describe('fetchAdvisorName', () => {
    let mockDataSource: Partial<DataSource>;

    beforeEach(() => {
      mockDataSource = {
        query: jest.fn(),
      };
    });

    it('should return "Todos los Asesores" if advisorId is omitted', async () => {
      const name = await fetchAdvisorName(mockDataSource as DataSource);
      expect(name).toBe('Todos los Asesores');
    });

    it('should return the advisor name from the database if found', async () => {
      (mockDataSource.query as jest.Mock).mockResolvedValue([{ name: 'Alberto Basabe' }]);
      const name = await fetchAdvisorName(mockDataSource as DataSource, 'advisor-123');
      expect(name).toBe('Alberto Basabe');
      expect(mockDataSource.query).toHaveBeenCalledWith(
        'SELECT name FROM advisors WHERE id = $1 AND deleted_at IS NULL',
        ['advisor-123'],
      );
    });

    it('should return "Asesor No Encontrado" if database query returns empty', async () => {
      (mockDataSource.query as jest.Mock).mockResolvedValue([]);
      const name = await fetchAdvisorName(mockDataSource as DataSource, 'advisor-123');
      expect(name).toBe('Asesor No Encontrado');
    });
  });

  describe('Excel Workbooks', () => {
    it('should create and finish a workbook successfully', async () => {
      const { workbook, ws } = createWorkbook('Test Sheet');
      expect(workbook).toBeDefined();
      expect(ws).toBeDefined();
      expect(ws.name).toBe('Test Sheet');

      const buffer = await finishWorkbook(workbook);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('Style Helpers', () => {
    let mockCell: ExcelJS.Cell;

    beforeEach(() => {
      mockCell = {
        font: {},
        alignment: {},
        fill: {},
        border: {},
      } as unknown as ExcelJS.Cell;
    });

    it('applyTitleRowStyle should set correct green background and white text', () => {
      applyTitleRowStyle(mockCell);
      expect(mockCell.font.name).toBe('Calibri');
      expect(mockCell.font.bold).toBe(true);
      expect((mockCell.fill as ExcelJS.FillPattern).type).toBe('pattern');
      expect((mockCell.fill as ExcelJS.FillPattern).pattern).toBe('solid');
    });

    it('applySectionHeaderStyle should set section background and white text', () => {
      applySectionHeaderStyle(mockCell);
      expect(mockCell.font.bold).toBe(true);
      expect((mockCell.fill as ExcelJS.FillPattern).type).toBe('pattern');
      expect((mockCell.fill as ExcelJS.FillPattern).pattern).toBe('solid');
    });

    it('applyTableHeaderStyle should set table header light gray background and dark text', () => {
      applyTableHeaderStyle(mockCell);
      expect(mockCell.font.bold).toBe(true);
      expect((mockCell.fill as ExcelJS.FillPattern).type).toBe('pattern');
      expect((mockCell.fill as ExcelJS.FillPattern).pattern).toBe('solid');
      expect(mockCell.border?.top?.style).toBe('thin');
      expect(mockCell.border?.bottom?.style).toBe('medium');
    });

    it('applyDataCellStyle should set Calibri 10 and thin borders', () => {
      applyDataCellStyle(mockCell);
      expect(mockCell.font.name).toBe('Calibri');
      expect(mockCell.font.size).toBe(10);
      expect(mockCell.border?.top?.style).toBe('thin');
    });

    it('applySubtotalCellStyle should set light green background and double bottom border', () => {
      applySubtotalCellStyle(mockCell);
      expect((mockCell.fill as ExcelJS.FillPattern).type).toBe('pattern');
      expect((mockCell.fill as ExcelJS.FillPattern).pattern).toBe('solid');
      expect(mockCell.border?.top?.style).toBe('medium');
      expect(mockCell.border?.bottom?.style).toBe('double');
    });

    it('applyGrandTotalStyle should set green background and white bold text', () => {
      applyGrandTotalStyle(mockCell, 'right');
      expect(mockCell.font.bold).toBe(true);
      expect(mockCell.alignment.horizontal).toBe('right');
      expect((mockCell.fill as ExcelJS.FillPattern).type).toBe('pattern');
      expect((mockCell.fill as ExcelJS.FillPattern).pattern).toBe('solid');
    });

    it('thinBorder should return correct thin borders object', () => {
      const borders = thinBorder('CCCCCC');
      expect(borders.top?.style).toBe('thin');
      expect(borders.top?.color?.argb).toBe('FFCCCCCC');
    });
  });
});
