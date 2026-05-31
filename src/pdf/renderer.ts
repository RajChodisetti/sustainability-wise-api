import puppeteer from 'puppeteer-core';
import { config } from '../config.js';

export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    executablePath: config.puppeteerExecutablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
