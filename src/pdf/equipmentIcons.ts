export const PDF_EQUIPMENT_ICON_NAMES = [
  'switchboard',
  'hvac',
  'lighting',
  'solar',
  'charger',
  'hot-water',
  'water',
  'electricity',
  'camera',
] as const;

export type PdfEquipmentIconName = (typeof PDF_EQUIPMENT_ICON_NAMES)[number];

const ICON_MARKUP: Record<PdfEquipmentIconName, string> = {
  switchboard: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h3M13 11h3M8 15h3M13 15h3M9 18h6"/>',
  hvac: '<path d="M12 2v20M4.9 6l14.2 12M19.1 6 4.9 18M9 4.5 12 7l3-2.5M9 19.5l3-2.5 3 2.5M5.5 9l.5-4 4 .5M18.5 15l-.5 4-4-.5M18.5 9l-.5-4-4 .5M5.5 15l.5 4 4-.5"/>',
  lighting: '<path d="M9 18h6M10 21h4M8.4 14.5A6 6 0 1 1 15.6 14.5c-.9.7-1.4 1.7-1.4 2.5h-4.4c0-.8-.5-1.8-1.4-2.5Z"/><path d="M12 2V1M4.9 4.9l-.7-.7M19.1 4.9l.7-.7"/>',
  solar: '<circle cx="7" cy="7" r="3"/><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M11.2 2.8 9.8 4.2M4.2 9.8l-1.4 1.4M5 15h14l2 7H3l2-7ZM8 15l-1 7M12 15v7M16 15l1 7M4 19h16"/>',
  charger: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M7 10h4M9 8v4M15 10h2a3 3 0 0 1 3 3v2M18 4v4M22 4v4M17 8h6M20 8v4"/>',
  'hot-water': '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M12 7c2 2.2 3 3.7 3 5a3 3 0 0 1-6 0c0-1.3 1-2.8 3-5ZM8 18h8"/>',
  water: '<path d="M12 2s7 7.2 7 12a7 7 0 0 1-14 0c0-4.8 7-12 7-12Z"/><path d="M9 15a3 3 0 0 0 3 2"/>',
  electricity: '<path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>',
  camera: '<path d="M4 7h3l1.5-2h7L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>',
};

/**
 * Inline vector markup keeps PDF icons independent of host emoji fonts.
 * All paths are ASCII-only so Chromium can print them consistently on Linux.
 */
export function renderPdfEquipmentIcon(name: PdfEquipmentIconName): string {
  return `<span class="iico" data-pdf-icon="${name}" aria-hidden="true"><svg class="iico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICON_MARKUP[name]}</svg></span>`;
}
