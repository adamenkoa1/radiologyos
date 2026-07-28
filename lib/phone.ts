export function normalizeUkrainianPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^380\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `38${digits}`;
  if (/^\d{9}$/.test(digits)) return `380${digits}`;
  return "";
}

