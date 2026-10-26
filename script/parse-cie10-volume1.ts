import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
// @ts-ignore
import { PDFParse } from 'pdf-parse';

export interface Cie10Exclusion {
  term: string;
  targetCode?: string;
}

export interface Cie10Metadata {
  inclusions?: string[];
  exclusions?: Cie10Exclusion[];
  notes?: string[];
  daggerAsterisk?: 'dagger' | 'asterisk' | null;
}

export interface Cie10RichItem {
  code: string;
  cleanCode: string;
  description: string;
  level: 'chapter' | 'block' | 'category' | 'subcategory';
  isTerminal: boolean;
  chapterNumber?: string;
  chapterTitle?: string;
  blockCode?: string;
  blockTitle?: string;
  categoryCode?: string;
  categoryTitle?: string;
  metadata: Cie10Metadata;
}

interface ChapterDef {
  number: string;
  title: string;
  range: string;
  cleanRange: string;
}

interface BlockDef {
  code: string;
  title: string;
  chapterNumber: string;
  chapterTitle: string;
}

interface CategoryDef {
  code: string;
  title: string;
  daggerAsterisk?: 'dagger' | 'asterisk' | null;
  blockCode?: string;
  blockTitle?: string;
  chapterNumber?: string;
  chapterTitle?: string;
}

const PDF_URL = 'https://ais.paho.org/classifications/chapters/pdf/volume1.pdf';
const PDF_PATH = path.resolve(__dirname, 'data/volume1.pdf');
const OUTPUT_JSON_PATH = path.resolve(__dirname, '../src/cie10/data/cie10-rich.json');

async function ensurePdfExists(): Promise<void> {
  const dir = path.dirname(PDF_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(PDF_PATH)) {
    const stats = fs.statSync(PDF_PATH);
    if (stats.size > 25 * 1024 * 1024) {
      console.log(`[CIE-10 Parser] Found cached PDF: ${PDF_PATH} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
  }

  console.log(`[CIE-10 Parser] Downloading PDF from ${PDF_URL}...`);
  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(PDF_PATH);
    https
      .get(PDF_URL, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download PDF: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('[CIE-10 Parser] Download complete.');
          resolve();
        });
      })
      .on('error', (err) => {
        fs.unlink(PDF_PATH, () => {});
        reject(err);
      });
  });
}

function normalizeDashes(str: string): string {
  return str.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-').trim();
}

function cleanCodeStr(str: string): string {
  return str.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Normaliza códigos con posibles artefactos de ligadura o negrita (ej: AA02 -> A02)
 */
function fixDoubleLetterArtifact(code: string): string {
  if (code.length === 4 && code[0] === code[1] && /\d{2}/.test(code.slice(2))) {
    return code.slice(1);
  }
  return code;
}

export async function parseVolume1(): Promise<Cie10RichItem[]> {
  await ensurePdfExists();

  console.log('[CIE-10 Parser] Initializing PDF reader...');
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  const parser = new PDFParse({ data: pdfBuffer });

  // 1. Extraer la lista de tres caracteres (páginas 35 a 105)
  console.log('[CIE-10 Parser] Extracting Three-Character Taxonomy (pages 35-105)...');
  const threeCharTextResult = await parser.getText({ first: 35, last: 105 });

  const chapters: ChapterDef[] = [];
  const blocks: BlockDef[] = [];
  const categories: Map<string, CategoryDef> = new Map();

  let curChapter: ChapterDef | null = null;
  let curBlock: BlockDef | null = null;

  const lines3 = threeCharTextResult.text.split('\n').map((l: string) => normalizeDashes(l.trim()));

  for (let i = 0; i < lines3.length; i++) {
    const line = lines3[i];
    if (!line) continue;

    // Saltar encabezados y pies de página
    if (
      line.includes('LISTA DE TRES CARACTERES') ||
      line.includes('CLASIFICACIÓN INTERNACIONAL') ||
      /^\d+$/.test(line) ||
      /^-- \d+ of \d+ --$/.test(line)
    ) {
      continue;
    }

    // Detectar Capítulo (ej: "Capítulo I", "Capítulo XXII")
    const chapMatch = line.match(/^Cap[ií]tulo\s+([IVXLCDM]+)$/i);
    if (chapMatch) {
      const num = chapMatch[1].toUpperCase();
      let title = '';
      let range = '';
      // Las siguientes líneas contienen el título y el rango entre paréntesis
      let j = i + 1;
      while (j < lines3.length && j <= i + 4) {
        const next = lines3[j];
        const rangeMatch = next.match(/^\(([A-Z]\d{2}-[A-Z]\d{2})\)$/);
        if (rangeMatch) {
          range = rangeMatch[1];
          i = j;
          break;
        } else if (!/^Cap[ií]tulo/i.test(next) && !next.includes('(')) {
          title = title ? `${title} ${next}` : next;
        } else if (next.includes('(')) {
          const combinedMatch = next.match(/(.*?)\s*\(([A-Z]\d{2}-[A-Z]\d{2})\)/);
          if (combinedMatch) {
            if (combinedMatch[1].trim()) {
              title = title ? `${title} ${combinedMatch[1].trim()}` : combinedMatch[1].trim();
            }
            range = combinedMatch[2];
            i = j;
            break;
          }
        }
        j++;
      }

      curChapter = {
        number: num,
        title: title || `Capítulo ${num}`,
        range,
        cleanRange: range.replace('-', ''),
      };
      chapters.push(curChapter);
      continue;
    }

    // Detectar Bloque: "Título del bloque (A00-A09)"
    const blockMatch = line.match(/^(.*?)\s*\(([A-Z]\d{2}-[A-Z]\d{2})\)$/);
    if (blockMatch && !/^Cap[ií]tulo/i.test(line)) {
      const title = blockMatch[1].trim();
      const code = blockMatch[2];
      curBlock = {
        code,
        title,
        chapterNumber: curChapter?.number || '',
        chapterTitle: curChapter?.title || '',
      };
      blocks.push(curBlock);
      continue;
    }

    // Detectar Categoría de 3 caracteres: "A00 \t Cólera" o "A17† \t Tuberculosis..."
    const catMatch = line.match(/^([A-Z]\d{2})([†*]?)\s+(.*)/);
    if (catMatch) {
      let code = catMatch[1];
      const symbol = catMatch[2] === '†' ? 'dagger' : catMatch[2] === '*' ? 'asterisk' : null;
      let title = catMatch[3].trim();

      // Verificar si el título se extiende a la siguiente línea
      while (i + 1 < lines3.length) {
        const next = lines3[i + 1];
        if (
          !next ||
          /^[A-Z]\d{2}/.test(next) ||
          next.includes('(') ||
          /^Cap[ií]tulo/i.test(next) ||
          next.includes('LISTA') ||
          /^\d+$/.test(next) ||
          next.startsWith('--')
        ) {
          break;
        }
        title = `${title} ${next}`;
        i++;
      }

      categories.set(code, {
        code,
        title,
        daggerAsterisk: symbol,
        blockCode: curBlock?.code,
        blockTitle: curBlock?.title,
        chapterNumber: curChapter?.number,
        chapterTitle: curChapter?.title,
      });
      continue;
    }
  }

  console.log(`[CIE-10 Parser] Extracted ${chapters.length} chapters, ${blocks.length} blocks, ${categories.size} 3-char categories.`);

  // 2. Extraer la lista tabular detallada de cuatro caracteres (páginas 109 a 1104)
  console.log('[CIE-10 Parser] Extracting Tabular List (pages 109-1104)...');
  const tabularTextResult = await parser.getText({ first: 109, last: 1104 });
  await parser.destroy();

  const linesTab = tabularTextResult.text.split('\n').map((l: string) => normalizeDashes(l.trim()));

  // Subcategorías de 4 caracteres
  interface SubcategoryExtracted {
    code: string;
    cleanCode: string;
    description: string;
    categoryCode: string;
    daggerAsterisk: 'dagger' | 'asterisk' | null;
    inclusions: string[];
    exclusions: Cie10Exclusion[];
    notes: string[];
  }

  const subcategories: Map<string, SubcategoryExtracted> = new Map();
  // Almacenar metadatos para categorías de 3 caracteres
  const catMetadata: Map<string, Cie10Metadata> = new Map();

  let activeCatCode: string | null = null;
  let activeSubCode: string | null = null;
  let parsingState: 'DESCRIPTION' | 'INCLUSIONS' | 'EXCLUSIONS' | 'NOTES' = 'DESCRIPTION';

  for (let i = 0; i < linesTab.length; i++) {
    const line = linesTab[i];
    if (!line) continue;

    // Ignorar pies de página y numeraciones
    if (
      line.includes('CLASIFICACIÓN INTERNACIONAL') ||
      line.includes('CIERTAS ENFERMEDADES') ||
      line.includes('CAPÍTULO') ||
      /^\d+$/.test(line) ||
      /^-- \d+ of \d+ --$/.test(line) ||
      line.startsWith('⎫') ||
      line.startsWith('⎬') ||
      line.startsWith('⎭')
    ) {
      continue;
    }

    // Detectar encabezado de bloque en la lista tabular (ej: "Enfermedades infecciosas intestinales\n(A00-A09)")
    const blockInlineMatch = line.match(/\(([A-Z]\d{2}-[A-Z]\d{2})\)/);
    if (blockInlineMatch) {
      parsingState = 'DESCRIPTION';
      continue;
    }

    // Detectar Categoría de 3 caracteres (ej: "A00 \t Cólera", o artifact "AA02 \t Otras...")
    const catTabMatch = line.match(/^([A-Z]{1,2}\d{2})([†*]?)\s+(.*)/);
    if (catTabMatch && !line.includes('.')) {
      let rawCode = fixDoubleLetterArtifact(catTabMatch[1]);
      if (/^[A-Z]\d{2}$/.test(rawCode)) {
        activeCatCode = rawCode;
        activeSubCode = null;
        parsingState = 'DESCRIPTION';

        if (!catMetadata.has(activeCatCode)) {
          catMetadata.set(activeCatCode, {
            inclusions: [],
            exclusions: [],
            notes: [],
            daggerAsterisk: catTabMatch[2] === '†' ? 'dagger' : catTabMatch[2] === '*' ? 'asterisk' : null,
          });
        }
        continue;
      }
    }

    // Detectar Subcategoría de 4 caracteres (ej: "A00.0 \t Cólera debido a Vibrio cholerae...")
    const subMatch = line.match(/^([A-Z]\d{2}\.[0-9A-Z])([†*]?)\s+(.*)/);
    if (subMatch) {
      const code = subMatch[1];
      const categoryCode = code.split('.')[0];
      activeCatCode = categoryCode;
      activeSubCode = code;
      parsingState = 'DESCRIPTION';

      const symbol = subMatch[2] === '†' ? 'dagger' : subMatch[2] === '*' ? 'asterisk' : null;
      let description = subMatch[3].trim();

      // Si la descripción está truncada y la siguiente línea continúa el título
      while (i + 1 < linesTab.length) {
        const next = linesTab[i + 1];
        if (
          !next ||
          /^[A-Z]\d{2}/.test(next) ||
          /^[A-Z]{1,2}\d{2}\.[0-9A-Z]/.test(next) ||
          next.startsWith('Incluye:') ||
          next.startsWith('Excluye:') ||
          next.startsWith('Nota:') ||
          next.startsWith('Notas:') ||
          next.includes('(') && /^[A-Z]\d{2}/.test(next.replace('(', '')) ||
          line.includes('CLASIFICACIÓN') ||
          next.startsWith('--')
        ) {
          break;
        }
        // Si no es un sinónimo o inclusión común sino continuación del nombre botánico/clínico
        if (
          description.endsWith(' a') ||
          description.endsWith(' de') ||
          description.endsWith(' con') ||
          description.endsWith(' por') ||
          description.endsWith(',') ||
          next.startsWith('Vibrio') ||
          next.startsWith('Salmonella') ||
          next.startsWith('Shigella') ||
          next.startsWith('Escherichia')
        ) {
          description = `${description} ${next}`;
          i++;
        } else {
          break;
        }
      }

      subcategories.set(code, {
        code,
        cleanCode: cleanCodeStr(code),
        description,
        categoryCode,
        daggerAsterisk: symbol,
        inclusions: [],
        exclusions: [],
        notes: [],
      });
      continue;
    }

    // Secciones de Inclusiones
    if (line.startsWith('Incluye:')) {
      parsingState = 'INCLUSIONS';
      const term = line.replace('Incluye:', '').trim();
      if (term) {
        if (activeSubCode && subcategories.has(activeSubCode)) {
          subcategories.get(activeSubCode)!.inclusions.push(term);
        } else if (activeCatCode && catMetadata.has(activeCatCode)) {
          catMetadata.get(activeCatCode)!.inclusions?.push(term);
        }
      }
      continue;
    }

    // Secciones de Exclusiones
    if (line.startsWith('Excluye:')) {
      parsingState = 'EXCLUSIONS';
      const termLine = line.replace('Excluye:', '').trim();
      if (termLine) {
        addExclusion(termLine, activeSubCode, activeCatCode, subcategories, catMetadata);
      }
      continue;
    }

    // Secciones de Notas
    if (line.startsWith('Nota:') || line.startsWith('Notas:') || line.startsWith('Use código adicional')) {
      parsingState = 'NOTES';
      const note = line.trim();
      if (activeSubCode && subcategories.has(activeSubCode)) {
        subcategories.get(activeSubCode)!.notes.push(note);
      } else if (activeCatCode && catMetadata.has(activeCatCode)) {
        catMetadata.get(activeCatCode)!.notes?.push(note);
      }
      continue;
    }

    // Procesar líneas subordinadas según el estado actual
    if (parsingState === 'INCLUSIONS') {
      if (activeSubCode && subcategories.has(activeSubCode)) {
        subcategories.get(activeSubCode)!.inclusions.push(line);
      } else if (activeCatCode && catMetadata.has(activeCatCode)) {
        catMetadata.get(activeCatCode)!.inclusions?.push(line);
      }
    } else if (parsingState === 'EXCLUSIONS') {
      addExclusion(line, activeSubCode, activeCatCode, subcategories, catMetadata);
    } else if (parsingState === 'NOTES') {
      if (activeSubCode && subcategories.has(activeSubCode)) {
        subcategories.get(activeSubCode)!.notes.push(line);
      } else if (activeCatCode && catMetadata.has(activeCatCode)) {
        catMetadata.get(activeCatCode)!.notes?.push(line);
      }
    } else if (parsingState === 'DESCRIPTION') {
      // Línea libre inmediatamente bajo una subcategoría (frecuentemente es un sinónimo clínico directo)
      if (activeSubCode && subcategories.has(activeSubCode) && !line.includes('(')) {
        subcategories.get(activeSubCode)!.inclusions.push(line);
      }
    }
  }

  console.log(`[CIE-10 Parser] Extracted ${subcategories.size} 4-char subcategories.`);

  // 3. Unificar en una sola colección estructurada Cie10RichItem[]
  console.log('[CIE-10 Parser] Assembling full rich catalog...');
  const catalog: Cie10RichItem[] = [];

  // A. Capítulos
  for (const chap of chapters) {
    catalog.push({
      code: chap.range || chap.number,
      cleanCode: chap.cleanRange || chap.number,
      description: chap.title,
      level: 'chapter',
      isTerminal: false,
      chapterNumber: chap.number,
      chapterTitle: chap.title,
      metadata: {},
    });
  }

  // B. Bloques
  for (const block of blocks) {
    catalog.push({
      code: block.code,
      cleanCode: block.code.replace('-', ''),
      description: block.title,
      level: 'block',
      isTerminal: false,
      blockCode: block.code,
      blockTitle: block.title,
      chapterNumber: block.chapterNumber,
      chapterTitle: block.chapterTitle,
      metadata: {},
    });
  }

  // C. Categorías de 3 caracteres
  for (const [code, cat] of categories.entries()) {
    // Si tiene subcategorías registradas, no es terminal. Si no tiene, es terminal.
    const hasSubcategories = Array.from(subcategories.keys()).some((sub) => sub.startsWith(`${code}.`));
    const meta = catMetadata.get(code) || {};
    if (cat.daggerAsterisk) {
      meta.daggerAsterisk = cat.daggerAsterisk;
    }

    catalog.push({
      code,
      cleanCode: code,
      description: cat.title,
      level: 'category',
      isTerminal: !hasSubcategories,
      categoryCode: code,
      categoryTitle: cat.title,
      blockCode: cat.blockCode,
      blockTitle: cat.blockTitle,
      chapterNumber: cat.chapterNumber,
      chapterTitle: cat.chapterTitle,
      metadata: {
        inclusions: meta.inclusions && meta.inclusions.length > 0 ? meta.inclusions : undefined,
        exclusions: meta.exclusions && meta.exclusions.length > 0 ? meta.exclusions : undefined,
        notes: meta.notes && meta.notes.length > 0 ? meta.notes : undefined,
        daggerAsterisk: meta.daggerAsterisk,
      },
    });
  }

  // D. Subcategorías de 4 caracteres
  for (const [code, sub] of subcategories.entries()) {
    const parentCat = categories.get(sub.categoryCode);

    catalog.push({
      code,
      cleanCode: sub.cleanCode,
      description: sub.description,
      level: 'subcategory',
      isTerminal: true,
      categoryCode: sub.categoryCode,
      categoryTitle: parentCat?.title,
      blockCode: parentCat?.blockCode,
      blockTitle: parentCat?.blockTitle,
      chapterNumber: parentCat?.chapterNumber,
      chapterTitle: parentCat?.chapterTitle,
      metadata: {
        inclusions: sub.inclusions.length > 0 ? sub.inclusions : undefined,
        exclusions: sub.exclusions.length > 0 ? sub.exclusions : undefined,
        notes: sub.notes.length > 0 ? sub.notes : undefined,
        daggerAsterisk: sub.daggerAsterisk,
      },
    });
  }

  // Guardar archivo JSON
  console.log(`[CIE-10 Parser] Saving ${catalog.length} items to ${OUTPUT_JSON_PATH}...`);
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(catalog, null, 2), 'utf-8');

  // Estadísticas finales
  const terminalCount = catalog.filter((i) => i.isTerminal).length;
  console.log('----------------------------------------------------');
  console.log(`[CIE-10 Parser] Process Complete!`);
  console.log(`Total items in rich catalog: ${catalog.length}`);
  console.log(`- Chapters: ${chapters.length}`);
  console.log(`- Blocks: ${blocks.length}`);
  console.log(`- 3-character categories: ${categories.size}`);
  console.log(`- 4-character subcategories: ${subcategories.size}`);
  console.log(`- Total clinically terminal codes (diagnosticables): ${terminalCount}`);
  console.log('----------------------------------------------------');

  return catalog;
}

function addExclusion(
  line: string,
  activeSubCode: string | null,
  activeCatCode: string | null,
  subcategories: Map<string, any>,
  catMetadata: Map<string, any>,
) {
  const m = line.match(/(.*?)\s*\(([A-Z]\d{2}(?:\.[0-9A-Z]|-?[A-Z]?\d{0,2})?.*)\)/);
  let term = line;
  let targetCode: string | undefined;

  if (m) {
    term = m[1].trim();
    targetCode = m[2].trim();
  }

  const exclusion: Cie10Exclusion = { term, targetCode };

  if (activeSubCode && subcategories.has(activeSubCode)) {
    subcategories.get(activeSubCode).exclusions.push(exclusion);
  } else if (activeCatCode && catMetadata.has(activeCatCode)) {
    catMetadata.get(activeCatCode).exclusions.push(exclusion);
  }
}

// Ejecutar si se invoca directamente desde CLI
if (require.main === module) {
  parseVolume1()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[CIE-10 Parser] Error:', err);
      process.exit(1);
    });
}
