import { readFile } from 'node:fs/promises';

const brandLogoUrl = new URL('./brand-logo.png', import.meta.url);
let brandLogoDataUriPromise: Promise<string> | null = null;

/**
 * Load the canonical Sustainability Wise wordmark once for HTML-to-PDF output.
 * A failed read is not cached so a corrected deployment can recover without a
 * process restart.
 */
export function loadBrandLogoDataUri(): Promise<string> {
  brandLogoDataUriPromise ??= readFile(brandLogoUrl)
    .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
    .catch((error) => {
      brandLogoDataUriPromise = null;
      throw error;
    });
  return brandLogoDataUriPromise;
}
