import { PageHeader } from '@/components/layout/PageHeader'
import { RoleHowItWorks } from '@/components/help/RoleHowItWorks'
import { useAuthStore } from '@/store/authStore'
import { APP_NAME } from '@/lib/branding'
import { isCompanyAdmin } from '@/lib/roles'

export function HowNovaCrmWorksPage() {
  const role = useAuthStore((s) => s.user?.role)
  const homeLabel = isCompanyAdmin(role) ? 'Analytics' : 'Home'

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-6">
      <PageHeader
        title="How it works"
        breadcrumbs={[{ label: APP_NAME }, { label: homeLabel, to: '/' }, { label: 'How it works' }]}
      />
      <RoleHowItWorks role={role} variant="full" />
    </div>
  )
}

export default HowNovaCrmWorksPage
