import puppeteer, { type Browser } from 'puppeteer-core';
import { config } from '../config.js';

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
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browser) return;
  await browser.close();
  browser = null;
}
