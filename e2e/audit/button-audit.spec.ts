import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Exhaustive button clickability audit for Sales / Desk / Engineer.
 * Clicks every visible enabled button/role=button in main (and key sheets),
 * records NONCLICK (click throws) and DEAD (click does nothing observable).
 *
 * Destructive labels skipped. Mutations soft — Escape after each click.
 * Run: AUDIT=1 npx playwright test e2e/audit/button-audit.spec.ts
 */
test.skip(!process.env.AUDIT, 'set AUDIT=1')

const PASSWORD = process.env.E2E_HMS_PASSWORD ?? 'Demo@12345'
const OUT = path.join('e2e', 'audit', 'out', 'buttons')
const SKIP = /delete|remove|log ?out|sign ?out|archive|deactivate|discard|revoke|disable|^send$|mark paid|approve & close|void|cancel order/i
const MAX_PER_PAGE = Number(process.env.AUDIT_MAX_BUTTONS ?? 40)

const ROLES: { id: string; email: string; routes: string[] }[] = [
  {
    id: 'sales',
    email: 'sales@hmsenterprises.in',
    routes: [
      '/',
      '/workqueue',
      '/sale-tracking',
      '/sale-tracking?open=1',
      '/contacts',
      '/contacts?open=1',
      '/deals',
      '/my-tasks',
      '/activities',
      '/erp/invoices',
      '/erp/products',
      '/erp/stock',
      '/erp/suppliers',
      '/erp/releases',
      '/settings',
      '/notifications',
      '/help',
      '/tickets',
    ],
  },
  {
    id: 'desk',
    email: 'desk@hmsenterprises.in',
    routes: [
      '/',
      '/workqueue',
      '/tickets',
      '/tickets?open=1&job=service',
      '/tickets?queue=awaiting',
      '/tickets?queue=progress',
      '/spare-parts',
      '/service-reports',
      '/amc',
      '/stamping',
      '/rentals',
      '/contacts',
      '/erp/products',
      '/erp/stock',
      '/erp/suppliers',
      '/settings',
      '/notifications',
      '/help',
      '/sale-tracking',
    ],
  },
  {
    id: 'engineer',
    email: 'engineer@hmsenterprises.in',
    routes: [
      '/',
      '/workqueue',
      '/tickets',
      '/spare-parts',
      '/service-reports',
      '/contacts',
      '/erp/products',
      '/erp/stock',
      '/erp/suppliers',
      '/settings',
      '/notifications',
      '/help',
      '/my-tasks',
      '/deals',
      '/sale-tracking',
      '/accounts',
    ],
  },
]

async function login(page: Page, email: string) {
  await page.goto('/login/hms')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 })
  await page.waitForTimeout(700)
}

type Hit = { route: string; label: string; reason?: string }

test.describe.configure({ mode: 'serial' })

for (const role of ROLES) {
  test(`button audit ${role.id}`, async ({ page }) => {
    test.setTimeout(20 * 60_000)
    const nonClickable: Hit[] = []
    const dead: Hit[] = []
    const disabled: Hit[] = []
    const pageNotes: string[] = []
    const consoleErrs: string[] = []

    page.on('pageerror', (e) => consoleErrs.push(`${e.message.slice(0, 120)}`))
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 120))
    })

    await login(page, role.email)
    await expect(page.locator('aside')).toBeVisible({ timeout: 20_000 })

    for (const route of role.routes) {
      await page.goto(route).catch(() => {})
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)

      const body = (await page.locator('body').innerText().catch(() => '')) || ''
      if (/Admin access required|Billing access required|You do not have access|Page not found|Something went wrong/i.test(body)) {
        pageNotes.push(`${route} => SKIP (${body.includes('Admin') ? 'admin-gate' : 'denied/error'})`)
        continue
      }

      const scope = (await page.locator('main').count()) ? 'main' : 'body'
      const buttons = await page.$$eval(`${scope} button, ${scope} [role="button"]`, (els) =>
        els.map((el, i) => {
          const e = el as HTMLElement
          const r = e.getBoundingClientRect()
          const style = getComputedStyle(e)
          const visible =
            r.width > 2 &&
            r.height > 2 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.pointerEvents !== 'none' &&
            Number(style.opacity || '1') > 0.05
          const label = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 60)
          const isDisabled =
            (e as HTMLButtonElement).disabled ||
            e.getAttribute('aria-disabled') === 'true' ||
            e.classList.contains('pointer-events-none')
          const peNone = style.pointerEvents === 'none'
          return { i, label, visible, isDisabled, peNone }
        }),
      )

      for (const b of buttons) {
        if (b.visible && (b.isDisabled || b.peNone) && b.label) {
          disabled.push({
            route,
            label: b.label,
            reason: b.peNone ? 'pointer-events:none' : 'disabled',
          })
        }
      }

      const clickable = buttons.filter((b) => b.visible && !b.isDisabled && !b.peNone && b.label)
      const seen = new Set<string>()
      let tested = 0

      for (const b of clickable) {
        if (tested >= MAX_PER_PAGE) break
        if (seen.has(b.label) || SKIP.test(b.label)) continue
        seen.add(b.label)
        tested++

        const loc = page.locator(`${scope} button, ${scope} [role="button"]`).nth(b.i)
        const url0 = page.url()
        const mut0 = await page.evaluate(() => (window as unknown as { __mut?: number }).__mut ?? 0).catch(() => 0)

        // install mut counter if missing
        await page
          .evaluate(() => {
            const w = window as unknown as { __mut?: number; __obs?: MutationObserver }
            if (w.__obs) return
            w.__mut = 0
            w.__obs = new MutationObserver((m) => {
              w.__mut = (w.__mut ?? 0) + m.length
            })
            w.__obs.observe(document.documentElement, {
              subtree: true,
              childList: true,
              attributes: true,
              characterData: true,
            })
          })
          .catch(() => {})

        try {
          await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {})
          await loc.click({ timeout: 2500, force: false })
        } catch (err) {
          const msg = String(err)
          if (/intercepts pointer|not visible|Timeout|not receive|outside of the viewport/i.test(msg)) {
            nonClickable.push({ route, label: b.label, reason: msg.slice(0, 100) })
          } else {
            nonClickable.push({ route, label: b.label, reason: msg.slice(0, 100) })
          }
          await page.keyboard.press('Escape').catch(() => {})
          continue
        }

        await page.waitForTimeout(450)
        const url1 = page.url()
        const dialog = (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible, [data-state="open"]').count()) > 0
        const toast = (await page.locator('[data-sonner-toast], [role="status"]').count()) > 0
        const mut1 = await page.evaluate(() => (window as unknown as { __mut?: number }).__mut ?? 0).catch(() => 0)
        const changed = url1 !== url0 || dialog || toast || mut1 > mut0 + 2

        if (!changed) {
          dead.push({ route, label: b.label, reason: 'no url/dialog/toast/dom change' })
        }

        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(150)
        if (page.url() !== url0) {
          await page.goto(route).catch(() => {})
          await page.waitForTimeout(500)
        }
      }

      pageNotes.push(`${route} => tested=${tested} visible=${clickable.length}`)
    }

    fs.mkdirSync(OUT, { recursive: true })
    const report = {
      role: role.id,
      email: role.email,
      pages: pageNotes,
      nonClickable,
      dead,
      disabled: disabled.slice(0, 80),
      consoleErrs: [...new Set(consoleErrs)].slice(0, 30),
      counts: {
        nonClickable: nonClickable.length,
        dead: dead.length,
        disabledSample: Math.min(disabled.length, 80),
      },
    }
    fs.writeFileSync(path.join(OUT, `${role.id}.json`), JSON.stringify(report, null, 2))
    console.log(
      `\n===== BUTTONS ${role.id} =====\nNONCLICK=${nonClickable.length} DEAD=${dead.length}\n` +
        nonClickable
          .slice(0, 15)
          .map((h) => `NONCLICK ${h.route} :: ${h.label}`)
          .join('\n') +
        '\n' +
        dead
          .slice(0, 20)
          .map((h) => `DEAD ${h.route} :: ${h.label}`)
          .join('\n'),
    )
  })
}
