import ExcelJS from 'exceljs';
import { readFile, access } from 'fs/promises';
import { Logger } from '@nestjs/common';
import {
  formatDateES as centralFormatDateES,
  getCaracasNow,
  getCaracasTodayJSDate,
} from '../common/utils/date.util';
import { join } from 'path';
import { DataSource } from 'typeorm';

// ---------------------------------------------------------------------------
// Brand colors from SIRCA's design system (without FF prefix – add it inline)
// ---------------------------------------------------------------------------
export const BRAND_COLORS = {
  primaryGreen: '1d9e11',
  darkText: '333333',
  mediumText: '666666',
  lightText: '999999',
  lightGrayBg: 'f8fafc',
  borderColor: 'e2e8f0',
  subtotalGreen: 'e8f5e9',
  white: 'FFFFFF',
};

// ---------------------------------------------------------------------------
// Month names in Spanish (index 0 = January)
// ---------------------------------------------------------------------------
export const MONTH_NAMES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

// ---------------------------------------------------------------------------
// Date & timestamp helpers
// ---------------------------------------------------------------------------

export const formatDateES = (date: Date | string): string => {
  return centralFormatDateES(date);
};

/**
 * Return the current timestamp formatted as a locale string in
 * Venezuela's timezone (America/Caracas).
 */
export const getGeneratedAtTimestamp = (): string => {
  return getCaracasNow().toFormat('d/M/yyyy, h:mm:ss a');
};

// ---------------------------------------------------------------------------
// Logo loading
// ---------------------------------------------------------------------------

/**
 * Load the company logo as a Base64 data-URI string suitable for embedding
 * in HTML/Handlebars PDF templates. Falls back from `src/` to `dist/`.
 * Returns an empty string if the logo is not found.
 */
export const loadLogoBase64 = async (logger: Logger): Promise<string> => {
  const attempts = [
    join(process.cwd(), 'src', 'assets', 'images', 'logo.png'),
    join(process.cwd(), 'dist', 'assets', 'images', 'logo.png'),
  ];

  for (const logoPath of attempts) {
    try {
      const logoBuffer = await readFile(logoPath);
      return `data:image/png;base64,${logoBuffer.toString('base64')}`;
    } catch {
      // try next path
    }
  }

  logger.warn('Company logo.png not found. Report will render without it.');
  return '';
};

/**
 * Return the resolved path of the company logo for use with ExcelJS
 * `workbook.addImage({ filename, extension })`. Falls back from `src/` to `dist/`.
 * Returns null if the logo is not found.
 */
export const loadLogoImagePath = async (logger: Logger): Promise<string | null> => {
  const attempts = [
    join(process.cwd(), 'src', 'assets', 'images', 'logo.png'),
    join(process.cwd(), 'dist', 'assets', 'images', 'logo.png'),
  ];

  for (const logoPath of attempts) {
    try {
      await access(logoPath);
      return logoPath;
    } catch {
      // try next path
    }
  }

  logger.warn('Company logo.png not found. Excel will render without it.');
  return null;
};

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the display name of an advisor from the database.
 * Returns 'Todos los Asesores' when advisorId is omitted.
 * Returns 'Asesor No Encontrado' when the ID does not match any record.
 */
export const fetchAdvisorName = async (
  dataSource: DataSource,
  advisorId?: string,
): Promise<string> => {
  if (!advisorId) return 'Todos los Asesores';

  const rows = await dataSource.query(
    'SELECT name, code FROM advisors WHERE id = $1 AND deleted_at IS NULL',
    [advisorId],
  );

  if (rows && rows.length > 0) {
    const advisor = rows[0];
    const formattedCode = advisor.code
      ? advisor.code < 1000
        ? String(advisor.code).padStart(3, '0')
        : String(advisor.code)
      : '';
    return formattedCode ? `${advisor.name} (${formattedCode})` : advisor.name;
  }

  return 'Asesor No Encontrado';
};

// ---------------------------------------------------------------------------
// ExcelJS workbook factory
// ---------------------------------------------------------------------------

/**
 * Create a new ExcelJS workbook with SIRCA metadata and a single worksheet
 * configured for landscape printing.
 */
export const createWorkbook = (
  sheetName: string,
): {
  workbook: ExcelJS.Workbook;
  ws: ExcelJS.Worksheet;
} => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIRCA - Sistema Integral';
  workbook.created = getCaracasTodayJSDate();

  const ws = workbook.addWorksheet(sheetName, {
    properties: { defaultColWidth: 15 },
    pageSetup: { orientation: 'landscape', fitToPage: true },
  });

  return { workbook, ws };
};

/**
 * Serialize a workbook to a Node.js Buffer.
 */
export const finishWorkbook = async (workbook: ExcelJS.Workbook): Promise<Buffer> => {
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
};

// ---------------------------------------------------------------------------
// ExcelJS cell-style helpers
// ---------------------------------------------------------------------------

/** Apply the main title row style (green background, white bold text, centred). */
export const applyTitleRowStyle = (cell: ExcelJS.Cell): void => {
  cell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: `FF${BRAND_COLORS.white}` } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_COLORS.primaryGreen}` },
  };
};

/** Apply the section/portfolio header style (green background, white bold text). */
export const applySectionHeaderStyle = (cell: ExcelJS.Cell): void => {
  cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: `FF${BRAND_COLORS.white}` } };
  cell.alignment = { horizontal: 'left', vertical: 'middle' };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_COLORS.primaryGreen}` },
  };
};

/** Apply table column-header style (light gray background, dark bold text, border). */
export const applyTableHeaderStyle = (cell: ExcelJS.Cell): void => {
  cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF334155' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.border = {
    top: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    bottom: { style: 'medium', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    left: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    right: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
  };
};

/** Apply a standard thin-border + Calibri 10 font to a data cell. */
export const applyDataCellStyle = (cell: ExcelJS.Cell): void => {
  cell.font = { name: 'Calibri', size: 10 };
  cell.border = {
    top: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    bottom: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    left: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    right: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
  };
};

/** Apply the subtotal row style (light-green fill, medium-top + double-bottom border). */
export const applySubtotalCellStyle = (cell: ExcelJS.Cell): void => {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_COLORS.subtotalGreen}` },
  };
  cell.border = {
    top: { style: 'medium', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    bottom: { style: 'double', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    left: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
    right: { style: 'thin', color: { argb: `FF${BRAND_COLORS.borderColor}` } },
  };
};

/** Apply the grand-total label/value cell style (green fill, white bold text). */
export const applyGrandTotalStyle = (
  cell: ExcelJS.Cell,
  align: 'left' | 'center' | 'right' = 'center',
): void => {
  cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: `FF${BRAND_COLORS.white}` } };
  cell.alignment = { horizontal: align, vertical: 'middle' };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_COLORS.primaryGreen}` },
  };
};

/** Return a standard thin-border object (for use with ExcelJS border property). */
export const thinBorder = (color = BRAND_COLORS.borderColor): Partial<ExcelJS.Borders> => {
  const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: `FF${color}` } };
  return { top: side, left: side, bottom: side, right: side };
};
