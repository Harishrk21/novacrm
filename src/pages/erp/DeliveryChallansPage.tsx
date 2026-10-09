import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Printer, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { api, ApiClientError } from '@/lib/api'
import {
  openPrintableDeliveryChallan,
  parseDeliveryChallan,
} from '@/lib/deliveryChallanPrint'
import { APP_NAME } from '@/lib/branding'
import { useUIStore } from '@/store/uiStore'

type DcRow = {
  purpose: 'SALE' | 'DEMO'
  number: string
  date: string
  customerName: string
  company?: string | null
  phone?: string | null
  productName?: string | null
  reqNumber?: string | null
  leadId?: string | null
  requisitionId?: string | null
  stockUnitId?: string | null
  challan: Record<string, unknown>
}

/** Warehouse archive of sale + demo delivery challans — reprint anytime. */
export function DeliveryChallansPage() {
  const addToast = useUIStore((s) => s.addToast)
  const [rows, setRows] = useState<DcRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [purpose, setPurpose] = useState<'ALL' | 'SALE' | 'DEMO'>('ALL')
  const [newDcOpen, setNewDcOpen] = useState(false)
  const [eligible, setEligible] = useState<Array<Record<string, unknown>>>([])
  const [eligibleLoading, setEligibleLoading] = useState(false)
  const [pickedReqId, setPickedReqId] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.deliveryChallans()
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not load delivery challans',
      })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (purpose !== 'ALL' && r.purpose !== purpose) return false
      if (!needle) return true
      const hay = [
        r.number,
        r.customerName,
        r.company,
        r.phone,
        r.productName,
        r.reqNumber,
        r.date,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [rows, q, purpose])

  async function openNewDc() {
    setNewDcOpen(true)
    setPickedReqId('')
    setEligibleLoading(true)
    try {
      const res = await api.requisitions({
        limit: 80,
        status: 'APPROVED,FULFILLED',
        queue: 'fulfill',
      })
      const ready = (res.items ?? []).filter((r) => {
        const cf =
          r.customFields && typeof r.customFields === 'object'
            ? (r.customFields as Record<string, unknown>)
            : {}
        if (cf.saleDcNo || cf.saleDeliveryChallan) return false
        const reduced =
          String(r.status) === 'FULFILLED' ||
          Boolean(cf.stockReducedAt) ||
          (Array.isArray(cf.releaseLines) && cf.releaseLines.length > 0)
        return reduced
      })
      setEligible(ready)
      if (ready[0]) setPickedReqId(String(ready[0].id))
    } catch (e) {
      setEligible([])
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not load releases for DC',
      })
    } finally {
      setEligibleLoading(false)
    }
  }

  async function createNewDc() {
    if (!pickedReqId) {
      addToast({ type: 'error', message: 'Select a sale release first' })
      return
    }
    setCreating(true)
    try {
      const row = await api.createRequisitionDeliveryChallan(pickedReqId)
      const cf =
        row.customFields && typeof row.customFields === 'object'
          ? (row.customFields as Record<string, unknown>)
          : {}
      const challan = parseDeliveryChallan(cf.saleDeliveryChallan)
      addToast({
        type: 'success',
        message: challan
          ? `Delivery challan ${challan.number} created`
          : 'Delivery challan created',
      })
      if (challan) openPrintableDeliveryChallan(challan, APP_NAME)
      setNewDcOpen(false)
      await load()
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiClientError ? e.message : 'Could not create delivery challan',
      })
    } finally {
      setCreating(false)
    }
  }

  function printRow(row: DcRow) {
    const challan = parseDeliveryChallan(row.challan)
    if (!challan) {
      addToast({ type: 'error', message: 'Challan data incomplete — open the sale / demo instead' })
      return
    }
    openPrintableDeliveryChallan(challan, APP_NAME)
  }

  const pickOptions = eligible.map((r) => {
    const cf =
      r.customFields && typeof r.customFields === 'object'
        ? (r.customFields as Record<string, unknown>)
        : {}
    const contact = r.contact as { name?: string; customerCode?: string } | null
    const lead = r.lead as { name?: string } | null
    const customer = contact?.name ?? lead?.name ?? String(cf.customerName ?? 'Customer')
    return {
      value: String(r.id),
      label: `${String(r.reqNumber ?? 'REQ')} · ${customer}`,
      sublabel: [
        String(r.productName ?? cf.productName ?? ''),
        contact?.customerCode,
        r.serialNo ? `S/No ${String(r.serialNo)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery challans"
        breadcrumbs={[{ label: 'ERP' }, { label: 'Delivery challans' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void openNewDc()}>
              <Plus size={14} /> New DC
            </Button>
            <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              Refresh
            </Button>
          </div>
        }
      />
      <p className="text-sm text-text-secondary">
        Sale (SDC-) and demo (DC-) challans. Use <strong>New DC</strong> after stock is reduced on{' '}
        <Link to="/erp/releases" className="font-medium text-accent-blue hover:underline">
          Approved releases
        </Link>
        , or create from the release Step 3.
      </p>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Input
              label="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="DC number, customer, product…"
            />
          </div>
          <div className="flex gap-1.5 pb-0.5">
            {(['ALL', 'SALE', 'DEMO'] as const).map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={purpose === p ? 'primary' : 'outline'}
                onClick={() => setPurpose(p)}
              >
                {p === 'ALL' ? 'All' : p === 'SALE' ? 'Sale' : 'Demo'}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-text-secondary">
            No delivery challans yet. Click <strong>New DC</strong> after reducing stock on an
            approved release, or issue a demo unit for a demo DC.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-text-secondary">
                  <th className="px-2 py-2 font-semibold">DC</th>
                  <th className="px-2 py-2 font-semibold">Type</th>
                  <th className="px-2 py-2 font-semibold">Date</th>
                  <th className="px-2 py-2 font-semibold">Customer</th>
                  <th className="px-2 py-2 font-semibold">Product</th>
                  <th className="px-2 py-2 font-semibold">Ref</th>
                  <th className="px-2 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.purpose}-${r.number}`} className="border-b border-border/70">
                    <td className="px-2 py-2.5 font-mono text-xs font-bold">{r.number}</td>
                    <td className="px-2 py-2.5">
                      <Badge color={r.purpose === 'SALE' ? 'blue' : 'amber'}>{r.purpose}</Badge>
                    </td>
                    <td className="px-2 py-2.5 text-text-secondary">{r.date || '—'}</td>
                    <td className="px-2 py-2.5">
                      <div className="font-medium text-text-primary">{r.customerName}</div>
                      {(r.company || r.phone) && (
                        <div className="text-[11px] text-text-secondary">
                          {[r.company, r.phone].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate px-2 py-2.5 text-text-secondary">
                      {r.productName || '—'}
                    </td>
                    <td className="px-2 py-2.5 text-[11px] text-text-secondary">
                      {r.reqNumber ? (
                        <span className="font-mono">{r.reqNumber}</span>
                      ) : r.leadId ? (
                        <Link
                          to={`/sale-tracking/${r.leadId}`}
                          className="text-accent-blue hover:underline"
                        >
                          Sale overview
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <Button type="button" size="sm" variant="outline" onClick={() => printRow(r)}>
                        <Printer size={14} />
                        Print
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={newDcOpen}
        onClose={() => !creating && setNewDcOpen(false)}
        title="New sale delivery challan"
        subtitle="Pick a release where stock is already reduced. Customer + machines fill automatically."
        size="md"
        accent="sky"
        footer={
          <>
            <Button variant="outline" disabled={creating} onClick={() => setNewDcOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={creating || eligibleLoading || !pickedReqId}
              onClick={() => void createNewDc()}
            >
              {creating ? 'Creating…' : 'Create DC'}
            </Button>
          </>
        }
      >
        {eligibleLoading ? (
          <p className="text-sm text-text-secondary">Loading releases…</p>
        ) : eligible.length === 0 ? (
          <div className="space-y-3 text-sm text-text-secondary">
            <p>
              No releases ready for a sale DC. Reduce stock first on{' '}
              <Link to="/erp/releases" className="font-medium text-accent-blue hover:underline">
                Approved releases
              </Link>{' '}
              (Step 2), then come back.
            </p>
          </div>
        ) : (
          <SearchableSelect
            label="Sale release *"
            value={pickedReqId}
            onChange={setPickedReqId}
            options={pickOptions}
            placeholder="Select REQ…"
          />
        )}
      </Modal>
    </div>
  )
}
