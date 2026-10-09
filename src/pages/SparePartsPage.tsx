import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, Warehouse } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SparePartsPanel } from '@/components/contacts/SparePartsPanel'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { isCompanyAdmin, isServiceEngineer, isServiceDesk } from '@/lib/roles'
import { useAuthStore } from '@/store/authStore'

/**
 * Service → Spare parts register.
 * Logs replacements across customers / jobs (load cells, printers, batteries, etc.).
 * Detail logging also stays on ticket & customer pages.
 */
export function SparePartsPage() {
  const role = useAuthStore((s) => s.user?.role)
  const canEdit =
    isCompanyAdmin(role) || isServiceEngineer(role) || isServiceDesk(role)
  const [key, setKey] = useState(0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Spare parts"
        breadcrumbs={[{ label: 'Service', to: '/tickets' }, { label: 'Spare parts' }]}
        actions={
          <Link to="/erp/spare-stock">
            <Button variant="outline">
              <Warehouse size={16} /> Spare stock (qty)
            </Button>
          </Link>
        }
      />

      <Card className="border-violet-200/70 bg-violet-50/40 p-4 text-sm text-text-secondary dark:border-violet-900/40 dark:bg-violet-950/20">
        <div className="flex items-start gap-2">
          <Package size={18} className="mt-0.5 shrink-0 text-violet-600" />
          <p>
            Service register for parts replaced or installed on customer machines. For warehouse
            quantity (billing / weighing spare lists, receive, issue to engineer, monthly open/close),
            use{' '}
            <Link to="/erp/spare-stock" className="font-medium text-accent-blue underline">
              Spare stock
            </Link>
            .
          </p>
        </div>
      </Card>

      <SparePartsPanel
        key={key}
        title="All spare part changes"
        canEdit={canEdit}
        defaultOpen
        onTicketUpdated={() => setKey((k) => k + 1)}
      />
    </div>
  )
}

export default SparePartsPage
