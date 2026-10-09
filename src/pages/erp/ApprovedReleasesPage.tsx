import { Link, Navigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { FeatureTip } from '@/components/tips/FeatureTip'
import { RequisitionsPanel } from '@/components/sales/RequisitionsPanel'
import { can } from '@/lib/permissions'
import { useAuthStore } from '@/store/authStore'

/** Warehouse stock-release queue — no proforma / accounts bootstrap. */
export function ApprovedReleasesPage() {
  const role = useAuthStore((s) => s.user?.role)
  const allowed =
    can(role, 'requisitions:fulfill') || can(role, 'requisitions:approve')

  if (!allowed) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approved releases"
        breadcrumbs={[{ label: 'ERP' }, { label: 'Approved releases' }]}
      />
      <FeatureTip
        title="Inventory work queue"
        body="Stamping → Reduce stock (serial goes to customer Machines + DC) → Create sale DC → Ready to ship (moves to Shipped, notifies sales). Trail: Stock → History."
        tipType="TIP"
      />
      <p className="text-xs text-text-secondary">
        Audit trail:{' '}
        <Link to="/erp/stock?view=history" className="font-medium text-accent-blue hover:underline">
          Stock → History
        </Link>
      </p>
      <RequisitionsPanel
        defaultQueue="fulfill"
        title="New sales for inventory"
        subtitle="Stamping → Reduce (serial on customer + DC) → Sale DC → Ready to ship. Multi-product sales: one Yes/No row each."
      />
    </div>
  )
}
