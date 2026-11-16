import { useModulesStore } from '@/store/modulesStore'

/**
 * Is WhatsApp switched on for this company (module "engagement.whatsapp")? Off ⇒ no WhatsApp prompts,
 * buttons or "customer gets a WhatsApp" wording anywhere — e.g. HMS has no WhatsApp account yet.
 * Defaults to OFF until modules have loaded, so nothing flashes up.
 */
export function useWhatsAppOn(): boolean {
  const enabled = useModulesStore((s) => s.enabled)
  const loaded = useModulesStore((s) => s.loaded)
  useModulesStore((s) => s.modules) // re-render when the module list arrives
  return loaded && enabled('engagement.whatsapp', false)
}
