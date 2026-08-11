import { Router } from 'express'
import { authRouter } from '../modules/auth/auth.routes.js'
import { platformRouter } from '../modules/platform/platform.routes.js'
import { tenantsRouter } from '../modules/tenants/tenants.routes.js'
import { leadsRouter } from '../modules/leads/leads.routes.js'
import { contactsRouter } from '../modules/contacts/contacts.routes.js'
import { dealsRouter } from '../modules/deals/deals.routes.js'
import { productsRouter } from '../modules/products/products.routes.js'
import { inventoryRouter } from '../modules/inventory/inventory.routes.js'
import { invoicesRouter } from '../modules/invoices/invoices.routes.js'
import { tipsRouter } from '../modules/tips/tips.routes.js'
import { searchRouter } from '../modules/search/search.routes.js'
import { integrationsRouter } from '../modules/integrations/integrations.routes.js'
import { accountsRouter } from '../modules/accounts/accounts.routes.js'
import { ticketsRouter } from '../modules/tickets/tickets.routes.js'
import { assetsRouter } from '../modules/assets/assets.routes.js'
import { purchaseOrdersRouter } from '../modules/purchaseOrders/purchaseOrders.routes.js'
import { metaRouter } from '../modules/meta/meta.routes.js'
import { usersRouter } from '../modules/users/users.routes.js'
import { uploadsRouter } from '../modules/uploads/uploads.routes.js'
import { analyticsRouter } from '../modules/analytics/analytics.routes.js'
import { activitiesRouter } from '../modules/activities/activities.routes.js'

export const apiRouter = Router()
apiRouter.use('/auth', authRouter)
apiRouter.use('/platform', platformRouter)
apiRouter.use('/tenants', tenantsRouter)
apiRouter.use('/meta', metaRouter)
apiRouter.use('/analytics', analyticsRouter)
apiRouter.use('/activities', activitiesRouter)
apiRouter.use('/users', usersRouter)
apiRouter.use('/uploads', uploadsRouter)
apiRouter.use('/accounts', accountsRouter)
apiRouter.use('/leads', leadsRouter)
apiRouter.use('/contacts', contactsRouter)
apiRouter.use('/deals', dealsRouter)
apiRouter.use('/tickets', ticketsRouter)
apiRouter.use('/assets', assetsRouter)
apiRouter.use('/products', productsRouter)
apiRouter.use('/inventory', inventoryRouter)
apiRouter.use('/purchase-orders', purchaseOrdersRouter)
apiRouter.use('/invoices', invoicesRouter)
apiRouter.use('/tips', tipsRouter)
apiRouter.use('/search', searchRouter)
apiRouter.use('/integrations', integrationsRouter)
