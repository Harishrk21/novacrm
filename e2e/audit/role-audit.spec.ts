import fs from 'node:fs'
import path from 'node:path'
import { test, type Page, type Route } from '@playwright/test'

/**
 * Read-only role audit crawler. Run with `AUDIT=1 npx playwright test e2e/audit`.
 * Every non-GET API call (except login/refresh) is blocked, so clicking buttons
 * never mutates the real database.
 */

const PASSWORD = process.env.E2E_HMS_PASSWORD ?? 'Demo@12345'
const ROLES: Record<string, string> = {
  admin: 'admin@hmsenterprises.in',
  desk: 'desk@hmsenterprises.in',
  engineer: 'engineer@hmsenterprises.in',
  warehouse: 'warehouse@hmsenterprises.in',
  sales: 'sales@hmsenterprises.in',
}

const PROBE_ROUTES = [
  '/', '/workqueue', '/help', '/my-tasks', '/sale-tracking', '/contacts', '/accounts', '/deals',
  '/activities', '/tickets', '/notifications', '/amc', '/stamping', '/rentals', '/spare-parts',
  '/service-reports', '/erp/hub', '/erp/products', '/erp/products/new', '/erp/stock',
  '/erp/stock/move', '/erp/stock/report', '/erp/inventory', '/erp/spare-stock', '/erp/suppliers',
  '/erp/brands', '/erp/purchase-orders', '/erp/releases', '/erp/delivery-challans', '/erp/invoices',
  '/reports', '/setup', '/settings', '/users', '/emails', '/whatsapp', '/team-chat',
]

const SKIP_LABEL = /delete|remove|log ?out|sign ?out|archive|deactivate|discard|revoke|disable|^send$/i
const API_RE = /(:10000\/|\/api\/)/
const MAX_BUTTONS = Number(process.env.AUDIT_MAX_BUTTONS ?? 35)
const OUT = path.join(process.cwd(), 'e2e', 'audit', 'out')

type PageReport = {
  path: string
  inNav: boolean
  state: 'ok' | 'denied' | 'notfound' | 'crash' | 'redirect' | 'blank'
  finalPath: string
  apiErrors: string[]
  api403: number
  consoleErrors: string[]
  pageErrors: string[]
  dead: string[]
  nonClickable: string[]
  disabled: string[]
  stuckDialogs: string[]
  blockedWrites: string[]
  leavePrompts: string[]
  toasts: string[]
  buttonsTested: number
}

test.skip(!process.env.AUDIT, 'set AUDIT=1 to run the role audit')
test.describe.configure({ mode: 'parallel' })

for (const [role, email] of Object.entries(ROLES)) {
  test(`audit ${role}`, async ({ page }) => {
    test.setTimeout(45 * 60_000)
    fs.mkdirSync(path.join(OUT, role), { recursive: true })

    let current: PageReport | null = null
    let requestCount = 0
    let dialogs = 0
    let popups = 0

    await page.addInitScript(() => {
      const w = window as unknown as { __mut: number }
      w.__mut = 0
      const start = () =>
        new MutationObserver((m) => (w.__mut += m.length)).observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        })
      if (document.documentElement) start()
      else document.addEventListener('DOMContentLoaded', start)
    })

    await page.route(API_RE, async (route: Route) => {
      const req = route.request()
      const url = req.url()
      if (req.method() === 'GET' || req.method() === 'OPTIONS' || /\/auth\/(login|refresh)/.test(url)) {
        return route.continue()
      }
      current?.blockedWrites.push(`${req.method()} ${new URL(url).pathname}`)
      return route.fulfill({
        status: 418,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Blocked by read-only audit' }),
      })
    })

    page.on('request', (r) => {
      if (!/\/@vite|\/node_modules\/|\.hot-update|\/src\//.test(r.url())) requestCount++
    })
    page.on('response', (r) => {
      if (!current || !API_RE.test(r.url()) || r.status() < 400 || r.status() === 418) return
      if (r.status() === 403) current.api403++
      current.apiErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
    })
    page.on('console', (m) => {
      if (m.type() === 'error' && current) current.consoleErrors.push(m.text().slice(0, 200))
    })
    page.on('pageerror', (e) => current?.pageErrors.push(e.message.slice(0, 200)))
    page.on('dialog', (d) => {
      if (d.type() === 'beforeunload') {
        current?.leavePrompts.push(current.path)
        void d.accept()
        return
      }
      dialogs++
      void d.dismiss()
    })
    page.context().on('page', (p) => {
      popups++
      void p.close()
    })

    // login
    await page.goto('/login/hms')
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
    await page.locator('aside a[href]').first().waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1000)

    // expand sidebar sections and collect nav links
    const sectionButtons = page.locator('aside nav > div > button')
    const n = await sectionButtons.count()
    for (let i = 0; i < n; i++) {
      const b = sectionButtons.nth(i)
      const open = await b.locator('svg.rotate-180').count()
      if (!open) await b.click().catch(() => {})
    }
    const navLinks = await page.$$eval('aside a[href]', (as) =>
      Array.from(new Set(as.map((a) => new URL((a as HTMLAnchorElement).href).pathname + new URL((a as HTMLAnchorElement).href).search))),
    )
    fs.writeFileSync(path.join(OUT, role, 'nav.json'), JSON.stringify(navLinks, null, 2))

    const navPaths = new Set(navLinks.map((l) => l.split('?')[0]))
    const targets = Array.from(new Set([...navLinks, ...PROBE_ROUTES]))
    const reports: PageReport[] = []

    for (const target of targets) {
      const inNav = navLinks.includes(target) || navPaths.has(target)
      current = {
        path: target, inNav, state: 'ok', finalPath: '', apiErrors: [], api403: 0, consoleErrors: [],
        pageErrors: [], dead: [], nonClickable: [], disabled: [], stuckDialogs: [], blockedWrites: [],
        leavePrompts: [], toasts: [], buttonsTested: 0,
      }
      reports.push(current)
      await page.goto(target).catch(() => {})
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(800)

      const finalUrl = new URL(page.url())
      current.finalPath = finalUrl.origin.includes('5190') ? finalUrl.pathname + finalUrl.search : page.url()
      const body = (await page.locator('body').innerText().catch(() => '')) || ''
      const h1 = (await page.locator('h1').allInnerTexts().catch(() => [])).join(' | ')
      current.toasts = await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])
      if (/You do not have access|Access required/i.test(h1 + body)) current.state = 'denied'
      else if (/Page not found/i.test(h1)) current.state = 'notfound'
      else if (/Something went wrong/i.test(h1)) current.state = 'crash'
      else if (finalUrl.pathname !== target.split('?')[0]) current.state = 'redirect'
      else if (body.trim().length < 40) current.state = 'blank'

      const safe = target.replace(/[^a-z0-9]+/gi, '_') || 'root'
      await page.screenshot({ path: path.join(OUT, role, `${safe}.png`) }).catch(() => {})

      // only deep-test buttons on pages that are in this role's nav and rendered
      if (!inNav || current.state !== 'ok' || process.env.AUDIT_NO_BUTTONS) continue
      const pageUrl = page.url()

      const scope = (await page.locator('main').count()) ? 'main' : 'body'
      const collect = () =>
        page.$$eval(`${scope} button, ${scope} [role="button"]`, (els) =>
          els.map((el, i) => {
            const e = el as HTMLElement
            const r = e.getBoundingClientRect()
            const visible = r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'
            const label = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 60)
            return { i, label, visible, disabled: (e as HTMLButtonElement).disabled || e.getAttribute('aria-disabled') === 'true', title: e.getAttribute('title') || '' }
          }),
        )
      const buttons = (await collect()).filter((b) => b.visible)
      const seen = new Set<string>()
      let tested = 0
      for (const b of buttons) {
        if (tested >= MAX_BUTTONS) break
        const key = b.label || `#${b.i}`
        if (seen.has(key)) continue
        seen.add(key)
        if (b.disabled) {
          current.disabled.push(key + (b.title ? ` (${b.title})` : ''))
          continue
        }
        if (SKIP_LABEL.test(b.label)) continue

        // re-resolve element by index and verify label still matches
        const now = await collect()
        const match = now.find((x) => x.label === b.label && x.visible && !x.disabled)
        if (!match) continue
        const loc = page.locator(`${scope} button, ${scope} [role="button"]`).nth(match.i)

        await page.evaluate(() => ((window as unknown as { __mut: number }).__mut = 0))
        await page.waitForTimeout(400)
        const idle = await page.evaluate(() => (window as unknown as { __mut: number }).__mut)
        await page.evaluate(() => ((window as unknown as { __mut: number }).__mut = 0))
        const req0 = requestCount
        const d0 = dialogs
        const p0 = popups
        const url0 = page.url()
        tested++
        try {
          await loc.click({ timeout: 2500 })
        } catch {
          current.nonClickable.push(key)
          continue
        }
        await page.waitForTimeout(700)
        const mut = await page.evaluate(() => (window as unknown as { __mut: number }).__mut)
        const changed =
          page.url() !== url0 || requestCount > req0 || dialogs > d0 || popups > p0 || mut > idle * 2 + 2
        if (!changed) current.dead.push(key)

        // restore state
        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(150)
        if (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count()) {
          await page.keyboard.press('Escape').catch(() => {})
          await page.waitForTimeout(150)
          if (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count()) {
            current.stuckDialogs.push(key)
            await page.goto(pageUrl).catch(() => {})
            await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
          }
        }
        if (page.url() !== pageUrl) {
          await page.goto(pageUrl).catch(() => {})
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
          await page.waitForTimeout(400)
        }
      }
      current.buttonsTested = tested
    }

    fs.writeFileSync(path.join(OUT, `${role}.json`), JSON.stringify(reports, null, 2))
  })
}
