export type InventoryAreas = {
  machines: boolean
  sparesBilling: boolean
  sparesWeighing: boolean
}

export const ALL_INVENTORY_AREAS: InventoryAreas = {
  machines: true,
  sparesBilling: true,
  sparesWeighing: true,
}

export const NO_INVENTORY_AREAS: InventoryAreas = {
  machines: false,
  sparesBilling: false,
  sparesWeighing: false,
}

export const INVENTORY_AREA_OPTIONS: Array<{
  key: keyof InventoryAreas
  label: string
  hint: string
}> = [
  {
    key: 'machines',
    label: 'Machines & product stock',
    hint: 'Serial stock for weighing / billing machines, Touch POS units, products catalog',
  },
  {
    key: 'sparesBilling',
    label: 'Billing / Touch POS spares',
    hint: 'Paper rolls, labels, batteries and other billing-machine spare quantity stock',
  },
  {
    key: 'sparesWeighing',
    label: 'Weighing machine spares',
    hint: 'Load cells, batteries and other weighing spare quantity stock',
  },
]

export function parseInventoryAreas(raw: unknown): InventoryAreas | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  return {
    machines: Boolean(o.machines),
    sparesBilling: Boolean(o.sparesBilling),
    sparesWeighing: Boolean(o.sparesWeighing),
  }
}

export function resolveInventoryAreas(
  preferencesOrAreas: unknown,
  roleCode?: string | null,
): InventoryAreas {
  if (preferencesOrAreas && typeof preferencesOrAreas === 'object' && !Array.isArray(preferencesOrAreas)) {
    const o = preferencesOrAreas as Record<string, unknown>
    if ('machines' in o || 'sparesBilling' in o || 'sparesWeighing' in o) {
      return {
        machines: Boolean(o.machines),
        sparesBilling: Boolean(o.sparesBilling),
        sparesWeighing: Boolean(o.sparesWeighing),
      }
    }
    const nested = parseInventoryAreas(o.inventoryAreas)
    if (nested) return nested
  }
  // Self-control model: everyone with a login can see all inventory areas unless
  // an admin explicitly restricted preferences.inventoryAreas on the user.
  void roleCode
  return { ...ALL_INVENTORY_AREAS }
}

export function hasAnyInventoryArea(areas: InventoryAreas): boolean {
  return areas.machines || areas.sparesBilling || areas.sparesWeighing
}

export function canSeeSpareFamily(
  areas: InventoryAreas,
  family: 'WEIGHING' | 'BILLING',
): boolean {
  return family === 'BILLING' ? areas.sparesBilling : areas.sparesWeighing
}
