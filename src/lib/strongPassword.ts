/** Random 14-char password (upper, lower, digit, symbol) for admin-set / reset passwords. */
export function strongPassword(length = 14): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%&*!?']
  const all = sets.join('')
  const pick = (chars: string) => {
    const n = new Uint32Array(1)
    crypto.getRandomValues(n)
    return chars[n[0]! % chars.length]!
  }
  const out = sets.map(pick)
  while (out.length < length) out.push(pick(all))
  for (let i = out.length - 1; i > 0; i--) {
    const n = new Uint32Array(1)
    crypto.getRandomValues(n)
    const j = n[0]! % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out.join('')
}
