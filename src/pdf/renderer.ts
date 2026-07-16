import puppeteer, { type Browser } from 'puppeteer-core';
import { config } from '../config.js';
import { stampPdfPageFrame, type PdfPageFrame } from './pageFrame.js';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      executablePath: config.puppeteerExecutablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
      ],
    });
  }

  return browser;
}

export async function renderPdf(html: string): Promise<Buffer> {
  const browserInstance = await getBrowser();
  const page = await browserInstance.newPage();
  let renderedPdf: Buffer | null = null;
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    await page.evaluate(async () => {
      await document.fonts?.ready;
      await Promise.all(
        Array.from(document.images)
          .filter((img) => !img.complete)
          .map((img) => new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })),
      );
    });
    const pageFrame: PdfPageFrame = await page.evaluate(() => {
      const header = document.querySelector('template[data-pdf-header]');
      const footer = document.querySelector('template[data-pdf-footer]');
      return {
        headerBrand: header?.getAttribute('data-brand') ?? '',
        headerTitle: header?.getAttribute('data-title') ?? '',
        footerLeft: footer?.getAttribute('data-left') ?? '',
        footerRight: footer?.getAttribute('data-right') ?? '',
      };
    });
    const hasPageFrame = Boolean(pageFrame.headerBrand || pageFrame.headerTitle || pageFrame.footerLeft || pageFrame.footerRight);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: hasPageFrame
        ? { top: '56px', right: '0', bottom: '30px', left: '0' }
        : { top: '0', right: '0', bottom: '0', left: '0' },
    });
    const browserPdf = Buffer.from(pdf);
    renderedPdf = hasPageFrame ? await stampPdfPageFrame(browserPdf, pageFrame) : browserPdf;
    return renderedPdf;
  } finally {
    try {
      await page.close();
    } catch (error) {
      if (renderedPdf) {
        console.warn('[pdf] Ignoring page close error after successful render', {
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        console.warn('[pdf] Page close failed after render error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!browserInstance.connected) {
        browser = null;
      }
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browser) return;
  await browser.close();
  browser = null;
}
