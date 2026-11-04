import { Link, Navigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { FeatureTip } from '@/components/tips/FeatureTip'
import { RequisitionsPanel } from '@/components/sales/RequisitionsPanel'
import { can } from '@/lib/permissions'
import { useAuthStore } from '@/store/authStore'

/** Warehouse stock-release queue — sales can view status; warehouse/admin fulfill. */
export function ApprovedReleasesPage() {
  const role = useAuthStore((s) => s.user?.role)
  const canFulfill = can(role, 'requisitions:fulfill')
  const canApprove = can(role, 'requisitions:approve')
  const canView = can(role, 'requisitions:view')
  const allowed = canFulfill || canApprove || canView

  if (!allowed) {
    return <Navigate to="/" replace />
  }

  const inventoryWorker = canFulfill || canApprove

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approved releases"
        breadcrumbs={[{ label: 'ERP' }, { label: 'Approved releases' }]}
      />
      <FeatureTip
        title={inventoryWorker ? 'How release works' : 'Release status'}
        body={
          inventoryWorker
            ? 'For each sale: open one product → stamp if needed → pick serial → Reduce. Do the next product the same way. When all products are done, create the DC and mark Ready to ship.'
            : 'After approval, inventory releases each product one by one, creates the DC, then marks Ready to ship. Stock actions stay with warehouse.'
        }
        tipType="TIP"
      />
      {inventoryWorker ? (
        <p className="text-xs text-text-secondary">
          Audit trail:{' '}
          <Link to="/erp/stock?view=history" className="font-medium text-accent-blue hover:underline">
            Stock → History
          </Link>
        </p>
      ) : null}
      <RequisitionsPanel
        defaultQueue="fulfill"
        title={inventoryWorker ? 'New sales for inventory' : 'Approved & in progress'}
        subtitle={
          inventoryWorker
            ? 'Open a sale → finish one product at a time (stamp → pick unit → reduce) → DC → Ready to ship.'
            : 'Read-only for sales desk — see what inventory is releasing and what has already shipped.'
        }
      />
    </div>
  )
}
