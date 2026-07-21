export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 60_000);
}

export function slugify(value: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'export';
}
