import type { AssetOrigin } from '@/types'

export const ASSET_ORIGIN_OPTIONS: Array<{ value: AssetOrigin; label: string; hint: string }> = [
  {
    value: 'SOLD_BY_US',
    label: 'Sold by us',
    hint: 'Machine purchased / installed from HMS — shows on customer products as our installed base',
  },
  {
    value: 'THIRD_PARTY',
    label: 'Outside — repair / stamping only',
    hint: 'Not sold by HMS — customer brought it for repair, service, or government stamping only',
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

/** Tags stored on asset customFields when desk adds a machine during a ticket. */
export type MachineSourceTag = 'Outside' | 'Service new' | 'Stamping'

export function machineSourceTagsFromCf(cf?: Record<string, unknown> | null): MachineSourceTag[] {
  if (!cf) return []
  const raw = cf.machineTags
  if (Array.isArray(raw)) {
    return raw.filter((t): t is MachineSourceTag =>
      t === 'Outside' || t === 'Service new' || t === 'Stamping',
    )
  }
  const out: MachineSourceTag[] = []
  if (cf.serviceNew === true) out.push('Service new')
  if (cf.visitPurpose === 'STAMPING' || cf.cameOnlyForStamping === true) out.push('Stamping')
  return out
}

/** New machine on a Service ticket → Outside + Service new */
export function serviceNewMachineTags(): MachineSourceTag[] {
  return ['Outside', 'Service new']
}

/** Outside machine on a Stamping ticket */
export function stampingOutsideMachineTags(): MachineSourceTag[] {
  return ['Outside', 'Stamping']
}
