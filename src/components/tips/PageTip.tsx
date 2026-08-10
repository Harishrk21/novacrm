import { useEffect } from 'react'
import { FeatureTip } from '@/components/tips/FeatureTip'
import { useTipsStore } from '@/store/tipsStore'

/** Loads tip for a module key (DEFAULT_TIPS + optional API) and renders FeatureTip */
export function PageTip({ moduleKey }: { moduleKey: string }) {
  const tip = useTipsStore((s) => s.get(moduleKey))
  const load = useTipsStore((s) => s.load)

  useEffect(() => {
    void load(moduleKey)
  }, [load, moduleKey])

  return <FeatureTip title={tip.title} body={tip.body} tipType={tip.tipType} />
}
