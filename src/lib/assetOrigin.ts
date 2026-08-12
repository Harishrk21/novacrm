import type { AssetOrigin } from '@/types'

export const ASSET_ORIGIN_OPTIONS: Array<{ value: AssetOrigin; label: string; hint: string }> = [
  {
    value: 'SOLD_BY_US',
    label: 'Sold by us',
    hint: 'Machine purchased from our shop (installed base)',
  },
  {
    value: 'THIRD_PARTY',
    label: 'Outside / repair only',
    hint: 'Not bought from us — customer brought it for repair or maintenance',
  },
]

export function assetOriginLabel(origin?: string | null) {
  if (origin === 'THIRD_PARTY') return 'Outside / repair only'
  return 'Sold by us'
}

export function assetOriginShort(origin?: string | null) {
  if (origin === 'THIRD_PARTY') return 'Outside'
  return 'Sold by us'
}

export function isThirdPartyOrigin(origin?: string | null) {
  return origin === 'THIRD_PARTY'
}
