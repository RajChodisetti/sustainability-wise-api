import { PDFDocument } from 'pdf-lib';

export async function mergePdfBuffers(parts: Buffer[]): Promise<Buffer> {
  if (parts.length === 0) {
    throw new Error('Cannot merge an empty PDF part list');
  }
  if (parts.length === 1) {
    return parts[0];
  }

  const merged = await PDFDocument.create();
  for (const part of parts) {
    const source = await PDFDocument.load(part);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) {
      merged.addPage(page);
    }
  }

  return Buffer.from(await merged.save());
}
