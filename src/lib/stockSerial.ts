/** Bump trailing digits: ABC1001 + 2 → ABC1003 */
export function bumpSerial(start: string, offset: number): string {
  const s = start.trim().toUpperCase()
  const m = s.match(/^(.*?)(\d+)$/)
  if (!m) {
    if (offset === 0) return s
    return `${s}-${offset + 1}`
  }
  const prefix = m[1] ?? ''
  const digits = m[2] ?? '0'
  const next = BigInt(digits) + BigInt(offset)
  return `${prefix}${next.toString().padStart(digits.length, '0')}`
}

export function expandSerialRange(startSerial: string, quantity: number): string[] {
  const n = Math.max(0, Math.floor(quantity))
  return Array.from({ length: n }, (_, i) => bumpSerial(startSerial, i))
}

export function parseSerialPaste(text: string): string[] {
  return text
    .split(/[\n,;\t]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
}
