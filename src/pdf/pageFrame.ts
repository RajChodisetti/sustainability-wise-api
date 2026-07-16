import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export type PdfPageFrame = {
  headerBrand: string;
  headerTitle: string;
  footerLeft: string;
  footerRight: string;
};

const PX_TO_PT = 72 / 96;
const HEADER_HEIGHT = 56 * PX_TO_PT;
const HEADER_BAND_HEIGHT = 48 * PX_TO_PT;
const FOOTER_HEIGHT = 30 * PX_TO_PT;
const FRAME_WIDTH = 2.5 * PX_TO_PT;

function pdfSafeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function fitText(value: string, font: PDFFont, size: number, maxWidth: number): string {
  const safe = pdfSafeText(value);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;

  const suffix = '...';
  let end = safe.length;
  while (end > 0 && font.widthOfTextAtSize(`${safe.slice(0, end)}${suffix}`, size) > maxWidth) {
    end -= 1;
  }
  return end > 0 ? `${safe.slice(0, end).trimEnd()}${suffix}` : '';
}

export async function stampPdfPageFrame(pdfBuffer: Buffer, frame: PdfPageFrame): Promise<Buffer> {
  const source = await PDFDocument.load(pdfBuffer);
  const document = await PDFDocument.create();
  const sourcePages = source.getPages();
  const embeddedPages = await document.embedPdf(source, source.getPageIndices());
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(20 / 255, 47 / 255, 112 / 255);
  const frameBlue = rgb(30 / 255, 58 / 255, 138 / 255);
  const paleBlue = rgb(147 / 255, 197 / 255, 253 / 255);
  const muted = rgb(148 / 255, 163 / 255, 184 / 255);
  const light = rgb(203 / 255, 213 / 255, 225 / 255);
  const white = rgb(1, 1, 1);

  for (let index = 0; index < sourcePages.length; index += 1) {
    const { width, height } = sourcePages[index].getSize();
    const page = document.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color: white });
    page.drawPage(embeddedPages[index], { x: 0, y: 0, width, height });
    const halfFrame = FRAME_WIDTH / 2;

    // Complete the outer page frame independently of how browser content fragments.
    page.drawLine({
      start: { x: halfFrame, y: FOOTER_HEIGHT },
      end: { x: halfFrame, y: height - HEADER_HEIGHT },
      thickness: FRAME_WIDTH,
      color: frameBlue,
    });
    page.drawLine({
      start: { x: width - halfFrame, y: FOOTER_HEIGHT },
      end: { x: width - halfFrame, y: height - HEADER_HEIGHT },
      thickness: FRAME_WIDTH,
      color: frameBlue,
    });

    // Repaint the reserved header/footer bands so every page has identical framing.
    page.drawRectangle({ x: 0, y: height - HEADER_HEIGHT, width, height: HEADER_HEIGHT, color: white });
    page.drawRectangle({ x: 0, y: height - HEADER_BAND_HEIGHT, width, height: HEADER_BAND_HEIGHT, color: navy });

    const brandSize = 10;
    const brand = fitText(frame.headerBrand, bold, brandSize, width * 0.3);
    const brandX = 13.5;
    const brandY = height - 23.5;
    page.drawText(brand, { x: brandX, y: brandY, size: brandSize, font: bold, color: white });

    const dividerX = Math.min(170, brandX + bold.widthOfTextAtSize(brand, brandSize) + 16);
    page.drawLine({
      start: { x: dividerX, y: height - 28.5 },
      end: { x: dividerX, y: height - 7.5 },
      thickness: 0.75,
      color: white,
      opacity: 0.28,
    });

    const titleX = dividerX + 12;
    const title = fitText(frame.headerTitle, bold, 9, width - titleX - 13.5);
    page.drawText(title, { x: titleX, y: height - 23, size: 9, font: bold, color: white, opacity: 0.92 });

    page.drawRectangle({
      x: halfFrame,
      y: halfFrame,
      width: width - FRAME_WIDTH,
      height: FOOTER_HEIGHT - halfFrame,
      color: white,
      borderColor: frameBlue,
      borderWidth: FRAME_WIDTH,
    });
    page.drawLine({
      start: { x: halfFrame, y: FOOTER_HEIGHT - 0.75 },
      end: { x: width - halfFrame, y: FOOTER_HEIGHT - 0.75 },
      thickness: 1.125,
      color: paleBlue,
    });

    const footerSize = 7;
    const footerY = 8;
    const footerLeft = fitText(frame.footerLeft, bold, footerSize, width * 0.38);
    page.drawText(footerLeft, { x: 15, y: footerY, size: footerSize, font: bold, color: muted });

    const footerRight = fitText(frame.footerRight, regular, footerSize, width * 0.48);
    const footerRightWidth = regular.widthOfTextAtSize(footerRight, footerSize);
    page.drawText(footerRight, {
      x: Math.max(width / 2, width - 15 - footerRightWidth),
      y: footerY,
      size: footerSize,
      font: regular,
      color: light,
    });
  }

  return Buffer.from(await document.save());
}
