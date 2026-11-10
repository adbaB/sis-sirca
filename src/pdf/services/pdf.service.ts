import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';

// Register standard Handlebars comparison and logical helpers
if (!handlebars.helpers['eq']) {
  handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
}
if (!handlebars.helpers['ne']) {
  handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
}
if (!handlebars.helpers['lt']) {
  handlebars.registerHelper('lt', (a: number, b: number) => a < b);
}
if (!handlebars.helpers['gt']) {
  handlebars.registerHelper('gt', (a: number, b: number) => a > b);
}
if (!handlebars.helpers['lte']) {
  handlebars.registerHelper('lte', (a: number, b: number) => a <= b);
}
if (!handlebars.helpers['gte']) {
  handlebars.registerHelper('gte', (a: number, b: number) => a >= b);
}
if (!handlebars.helpers['and']) {
  handlebars.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every(Boolean));
}
if (!handlebars.helpers['or']) {
  handlebars.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some(Boolean));
}
if (!handlebars.helpers['not']) {
  handlebars.registerHelper('not', (a: unknown) => !a);
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /**
   * Genera un PDF a partir de una plantilla Handlebars
   * @param templateName Nombre del archivo sin extensión (ej. 'invoice')
   * @param data Objeto con los datos a inyectar en la plantilla
   */
  async generatePdf(
    templateName: string,
    data: Record<string, unknown>,
    options?: {
      landscape?: boolean;
      margin?: { top?: string; right?: string; bottom?: string; left?: string };
      displayHeaderFooter?: boolean;
      headerTemplate?: string;
      footerTemplate?: string;
    },
  ): Promise<Buffer> {
    let browser: puppeteer.Browser | null = null;
    try {
      // 1. Read the template file.
      //    In production (node dist/) the file lives in dist/pdf/templates/.
      //    In dev (ts-node / nest start --watch) it lives in src/pdf/templates/.
      const distTemplatePath = path.join(
        process.cwd(),
        'dist',
        'pdf',
        'templates',
        `${templateName}.hbs`,
      );
      const srcTemplatePath = path.join(
        process.cwd(),
        'src',
        'pdf',
        'templates',
        `${templateName}.hbs`,
      );

      let templateHtml: string;
      try {
        templateHtml = await fs.readFile(distTemplatePath, 'utf8');
      } catch {
        // dist not available — running in dev mode
        templateHtml = await fs.readFile(srcTemplatePath, 'utf8');
      }

      // 2. Compile HTML with Handlebars and inject data
      const template = handlebars.compile(templateHtml);
      const finalHtml = template(data);

      // 3. Launch Puppeteer
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // prevents crashes on low /dev/shm Linux servers
          '--disable-gpu', // not needed in headless mode
          '--no-first-run',
          '--no-zygote',
        ],
      });

      const page = await browser.newPage();

      // 4. Load the final HTML — all external resources must be pre-embedded as
      //    data URIs before calling this method to avoid network timeouts.
      await page.setContent(finalHtml, { waitUntil: 'load' });

      // 5. Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'Letter',
        landscape: options?.landscape ?? false,
        printBackground: true,
        margin: options?.margin ?? { top: '20px', right: '20px', bottom: '50px', left: '20px' },
        displayHeaderFooter: options?.displayHeaderFooter ?? true,
        headerTemplate: options?.headerTemplate ?? '<div></div>',
        footerTemplate:
          options?.footerTemplate ??
          '<div style="width: 100%; text-align: right; padding-right: 20px; font-size: 8px; color: #555;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error(`Error generating PDF for template ${templateName}:`, error);
      throw error;
    } finally {
      if (browser) {
        await browser.close().catch((closeErr) => {
          this.logger.error('Error closing Puppeteer browser instance:', closeErr);
        });
      }
    }
  }
}
