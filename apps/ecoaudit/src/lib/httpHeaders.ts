/** Add a cache-key field without discarding upstream Vary behavior. */
export function mergeVaryHeaderValue(
  existing: string | null | undefined,
  requiredField: string,
): string {
  const values = (existing ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.includes('*')) return '*';
  if (!values.some((value) => value.toLowerCase() === requiredField.toLowerCase())) {
    values.push(requiredField);
  }
  return values.join(', ');
}
