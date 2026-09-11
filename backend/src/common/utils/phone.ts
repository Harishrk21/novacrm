/** Normalize to digits for WhatsApp / CRM matching. 10-digit India mobiles become 91XXXXXXXXXX. */
export function normalizePhone(value?: string | null): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith("0") && /^[6-9]/.test(digits.slice(1))) {
    digits = `91${digits.slice(1)}`;
  } else if (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits.slice(2))) {
    // already E.164-ish without +
  } else if (digits.length === 10) {
    digits = `91${digits}`;
  }
  return digits.slice(-15) || null;
}

/** True when value is a valid Indian mobile (10 national digits starting 6–9). */
export function isIndianMobile(value?: string | null): boolean {
  const n = normalizePhone(value);
  if (!n || n.length < 12) return false;
  const local = n.startsWith("91") ? n.slice(-10) : n.slice(-10);
  return /^[6-9]\d{9}$/.test(local);
}
