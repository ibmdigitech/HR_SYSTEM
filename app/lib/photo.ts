export function normalizeEmployeePhotoValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const valid = /^https?:\/\//.test(trimmed)
    || trimmed.startsWith("/")
    || trimmed.startsWith("data:")
    || trimmed.startsWith("blob:");

  return valid ? trimmed : null;
}
