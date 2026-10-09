import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireTenantAuth } from '@/components/auth/RequireTenantAuth'
import { RequirePlatformAuth } from '@/components/auth/RequirePlatformAuth'
import {
  RequireCompanyAdmin,
  RequireErpAccess,
  RequireBillingAccess,
} from '@/components/auth/RequireCompanyAdmin'
import { LoginPage } from '@/pages/LoginPage'
import { PlatformLoginPage } from '@/pages/PlatformLoginPage'
import { LeadsRedirect } from '@/components/routing/LeadsRedirect'
import { PageSkeleton } from '@/components/ui/Skeleton'

/** Route chunks — keep login + shell eager; defer every heavy page. */
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const HowNovaCrmWorksPage = lazy(() =>
  import('@/pages/HowNovaCrmWorksPage').then((m) => ({ default: m.HowNovaCrmWorksPage })),
)
const MyTasksPage = lazy(() =>
  import('@/pages/MyTasksPage').then((m) => ({ default: m.MyTasksPage })),
)
const LeadsPage = lazy(() =>
  import('@/pages/LeadsPage').then((m) => ({ default: m.LeadsPage })),
)
const LeadDetailPage = lazy(() =>
  import('@/pages/LeadDetailPage').then((m) => ({ default: m.LeadDetailPage })),
)
const ContactsPage = lazy(() =>
  import('@/pages/ContactsPage').then((m) => ({ default: m.ContactsPage })),
)
const ContactDetailPage = lazy(() =>
  import('@/pages/ContactDetailPage').then((m) => ({ default: m.ContactDetailPage })),
)
const AccountsPage = lazy(() =>
  import('@/pages/AccountsPage').then((m) => ({ default: m.AccountsPage })),
)
const AccountDetailPage = lazy(() =>
  import('@/pages/AccountDetailPage').then((m) => ({ default: m.AccountDetailPage })),
)
const DealsPage = lazy(() =>
  import('@/pages/DealsPage').then((m) => ({ default: m.DealsPage })),
)
const DealDetailPage = lazy(() =>
  import('@/pages/DealDetailPage').then((m) => ({ default: m.DealDetailPage })),
)
const ActivitiesPage = lazy(() =>
  import('@/pages/ActivitiesPage').then((m) => ({ default: m.ActivitiesPage })),
)
const TicketsPage = lazy(() =>
  import('@/pages/TicketsPage').then((m) => ({ default: m.TicketsPage })),
)
const TicketDetailPage = lazy(() =>
  import('@/pages/TicketDetailPage').then((m) => ({ default: m.TicketDetailPage })),
)
const AmcPage = lazy(() => import('@/pages/AmcPage').then((m) => ({ default: m.AmcPage })))
const StampingPage = lazy(() =>
  import('@/pages/StampingPage').then((m) => ({ default: m.StampingPage })),
)
const RentalsPage = lazy(() =>
  import('@/pages/RentalsPage').then((m) => ({ default: m.RentalsPage })),
)
const SparePartsPage = lazy(() =>
  import('@/pages/SparePartsPage').then((m) => ({ default: m.SparePartsPage })),
)
const ServiceReportsPage = lazy(() =>
  import('@/pages/ServiceReportsPage').then((m) => ({ default: m.ServiceReportsPage })),
)
const ReportsPage = lazy(() =>
  import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
)
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const SetupHomePage = lazy(() =>
  import('@/pages/SetupHomePage').then((m) => ({ default: m.SetupHomePage })),
)
const WorkqueuePage = lazy(() =>
  import('@/pages/WorkqueuePage').then((m) => ({ default: m.WorkqueuePage })),
)
const NotificationsPage = lazy(() =>
  import('@/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
)
const UsersPage = lazy(() =>
  import('@/pages/UsersPage').then((m) => ({ default: m.UsersPage })),
)
const EmailsPage = lazy(() =>
  import('@/pages/EmailsPage').then((m) => ({ default: m.EmailsPage })),
)
const WhatsAppPage = lazy(() =>
  import('@/pages/WhatsAppPage').then((m) => ({ default: m.WhatsAppPage })),
)
const AdminApp = lazy(() =>
  import('@/pages/admin/AdminApp').then((m) => ({ default: m.AdminApp })),
)
const InventoryPage = lazy(() =>
  import('@/pages/erp/InventoryPage').then((m) => ({ default: m.InventoryPage })),
)
const InventoryHubPage = lazy(() =>
  import('@/pages/erp/InventoryHubPage').then((m) => ({ default: m.InventoryHubPage })),
)
const InventoryHubRedirect = lazy(() =>
  import('@/pages/erp/InventoryHubPage').then((m) => ({ default: m.InventoryHubRedirect })),
)
const InvoicesPage = lazy(() =>
  import('@/pages/erp/InvoicesPage').then((m) => ({ default: m.InvoicesPage })),
)
const ApprovedReleasesPage = lazy(() =>
  import('@/pages/erp/ApprovedReleasesPage').then((m) => ({ default: m.ApprovedReleasesPage })),
)
const ProductDetailPage = lazy(() =>
  import('@/pages/erp/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage })),
)
const PurchaseOrdersPage = lazy(() =>
  import('@/pages/erp/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })),
)
const SuppliersPage = lazy(() =>
  import('@/pages/erp/SuppliersPage').then((m) => ({ default: m.SuppliersPage })),
)
const BrandsPage = lazy(() =>
  import('@/pages/erp/BrandsPage').then((m) => ({ default: m.BrandsPage })),
)
const StockMovePage = lazy(() =>
  import('@/pages/erp/StockMovePage').then((m) => ({ default: m.StockMovePage })),
)
const DeliveryChallansPage = lazy(() =>
  import('@/pages/erp/DeliveryChallansPage').then((m) => ({ default: m.DeliveryChallansPage })),
)

function RouteFallback() {
  return (
    <div className="p-6">
      <PageSkeleton />
    </div>
  )
}

/**
 * BrowserRouter + Routes (not createBrowserRouter).
 * The data router + useBlocker left the address bar ahead of React location
 * (URL /sale-tracking while Outlet stayed on Dashboard).
 */
export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/admin" element={<PlatformLoginPage />} />
          <Route path="/login/:slug" element={<LoginPage />} />
          <Route
            path="/admin/*"
            element={
              <RequirePlatformAuth>
                <AdminApp />
              </RequirePlatformAuth>
            }
          />
          <Route
            element={
              <RequireTenantAuth>
                <AppLayout />
              </RequireTenantAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="workqueue" element={<WorkqueuePage />} />
            <Route path="help" element={<HowNovaCrmWorksPage />} />
            <Route path="my-tasks" element={<MyTasksPage />} />
            <Route path="sale-tracking" element={<LeadsPage />} />
            <Route path="sale-tracking/:id" element={<LeadDetailPage />} />
            <Route path="leads" element={<LeadsRedirect />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="contacts/:id" element={<ContactDetailPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="accounts/:id" element={<AccountDetailPage />} />
            <Route path="deals" element={<DealsPage />} />
            <Route path="deals/:id" element={<DealDetailPage />} />
            <Route
              path="activities"
              element={
                <RequireCompanyAdmin>
                  <ActivitiesPage />
                </RequireCompanyAdmin>
              }
            />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/:id" element={<TicketDetailPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="amc" element={<AmcPage />} />
            <Route path="stamping" element={<StampingPage />} />
            <Route path="rentals" element={<RentalsPage />} />
            <Route path="spare-parts" element={<SparePartsPage />} />
            <Route path="service-reports" element={<ServiceReportsPage />} />
            <Route
              path="erp/hub"
              element={
                <RequireErpAccess>
                  <InventoryHubRedirect />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/products"
              element={
                <RequireErpAccess>
                  <InventoryHubPage section="catalog" />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/products/new"
              element={
                <RequireErpAccess>
                  <Navigate to="/erp/products?open=1&category=MACHINE" replace />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/products/:id"
              element={
                <RequireErpAccess>
                  <ProductDetailPage />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/stock"
              element={
                <RequireErpAccess>
                  <InventoryHubPage section="stock" />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/stock/move"
              element={
                <RequireErpAccess>
                  <StockMovePage />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/stock/report"
              element={
                <RequireErpAccess>
                  <InventoryHubPage section="report" />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/inventory"
              element={
                <RequireErpAccess>
                  <InventoryPage />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/spare-stock"
              element={
                <RequireErpAccess>
                  <Navigate to="/erp/stock?category=SPARE" replace />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/suppliers"
              element={
                <RequireErpAccess>
                  <SuppliersPage />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/brands"
              element={
                <RequireErpAccess>
                  <BrandsPage />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/purchase-orders"
              element={
                <RequireCompanyAdmin>
                  <PurchaseOrdersPage />
                </RequireCompanyAdmin>
              }
            />
            <Route
              path="erp/releases"
              element={
                <RequireErpAccess>
                  <ApprovedReleasesPage />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/delivery-challans"
              element={
                <RequireErpAccess>
                  <DeliveryChallansPage />
                </RequireErpAccess>
              }
            />
            <Route
              path="erp/invoices"
              element={
                <RequireBillingAccess>
                  <InvoicesPage />
                </RequireBillingAccess>
              }
            />
            <Route
              path="reports"
              element={
                <RequireCompanyAdmin>
                  <ReportsPage />
                </RequireCompanyAdmin>
              }
            />
            <Route
              path="setup"
              element={
                <RequireCompanyAdmin>
                  <SetupHomePage />
                </RequireCompanyAdmin>
              }
            />
            <Route path="settings" element={<SettingsPage />} />
            <Route
              path="users"
              element={
                <RequireCompanyAdmin>
                  <UsersPage />
                </RequireCompanyAdmin>
              }
            />
            <Route
              path="emails"
              element={
                <RequireCompanyAdmin>
                  <EmailsPage />
                </RequireCompanyAdmin>
              }
            />
            <Route path="whatsapp" element={<WhatsAppPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
