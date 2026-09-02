import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireTenantAuth } from '@/components/auth/RequireTenantAuth'
import { RequireCompanyAdmin } from '@/components/auth/RequireCompanyAdmin'
import { DashboardPage } from '@/pages/DashboardPage'
import { HowNovaCrmWorksPage } from '@/pages/HowNovaCrmWorksPage'
import { MyTasksPage } from '@/pages/MyTasksPage'
import { LeadsPage } from '@/pages/LeadsPage'
import { ContactsPage } from '@/pages/ContactsPage'
import { ContactDetailPage } from '@/pages/ContactDetailPage'
import { AccountsPage } from '@/pages/AccountsPage'
import { AccountDetailPage } from '@/pages/AccountDetailPage'
import { DealsPage } from '@/pages/DealsPage'
import { DealDetailPage } from '@/pages/DealDetailPage'
import { ActivitiesPage } from '@/pages/ActivitiesPage'
import { TicketsPage } from '@/pages/TicketsPage'
import { TicketDetailPage } from '@/pages/TicketDetailPage'
import { AmcPage } from '@/pages/AmcPage'
import { StampingPage } from '@/pages/StampingPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { UsersPage } from '@/pages/UsersPage'
import { EmailsPage } from '@/pages/EmailsPage'
import { WhatsAppPage } from '@/pages/WhatsAppPage'
import { AdminApp } from '@/pages/admin/AdminApp'
import { LoginPage } from '@/pages/LoginPage'
import { LeadsRedirect } from '@/components/routing/LeadsRedirect'
import {
  InventoryPage,
  InvoicesPage,
  ProductsPage,
  ProductDetailPage,
  PurchaseOrdersPage,
} from '@/pages/erp/ErpPages'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route
          element={
            <RequireTenantAuth>
              <AppLayout />
            </RequireTenantAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="help" element={<HowNovaCrmWorksPage />} />
          <Route path="my-tasks" element={<MyTasksPage />} />
          <Route path="sale-tracking" element={<LeadsPage />} />
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
          <Route path="amc" element={<AmcPage />} />
          <Route path="stamping" element={<StampingPage />} />
          <Route
            path="erp/products"
            element={
              <RequireCompanyAdmin>
                <ProductsPage />
              </RequireCompanyAdmin>
            }
          />
          <Route
            path="erp/products/new"
            element={
              <RequireCompanyAdmin>
                <Navigate to="/erp/products?tab=create" replace />
              </RequireCompanyAdmin>
            }
          />
          <Route
            path="erp/products/:id"
            element={
              <RequireCompanyAdmin>
                <ProductDetailPage />
              </RequireCompanyAdmin>
            }
          />
          <Route
            path="erp/inventory"
            element={
              <RequireCompanyAdmin>
                <InventoryPage />
              </RequireCompanyAdmin>
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
            path="erp/invoices"
            element={
              <RequireCompanyAdmin>
                <InvoicesPage />
              </RequireCompanyAdmin>
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
    </BrowserRouter>
  )
}
