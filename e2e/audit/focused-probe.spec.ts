import { expect, test, type Page } from '@playwright/test'

/**
 * Focused HMS probe: login each role, capture nav + home health, click primary
 * visible actions (read-only — destructive labels skipped). Set AUDIT=1 to run.
 */
test.skip(!process.env.AUDIT, 'set AUDIT=1')

const PASSWORD = process.env.E2E_HMS_PASSWORD ?? 'Demo@12345'
const ROLES: { id: string; email: string }[] = [
  { id: 'admin', email: 'admin@hmsenterprises.in' },
  { id: 'desk', email: 'desk@hmsenterprises.in' },
  { id: 'engineer', email: 'engineer@hmsenterprises.in' },
  { id: 'warehouse', email: 'warehouse@hmsenterprises.in' },
  { id: 'sales', email: 'sales@hmsenterprises.in' },
]

const SKIP = /delete|remove|log ?out|sign ?out|archive|deactivate|discard|revoke|disable|^send$/i

async function login(page: Page, email: string) {
  await page.goto('/login/hms')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 })
  await page.waitForTimeout(1500)
}

async function expandNav(page: Page) {
  const buttons = page.locator('aside nav button')
  const n = await buttons.count()
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i)
    const rotated = await b.locator('svg.rotate-180').count()
    if (!rotated) await b.click({ timeout: 1000 }).catch(() => {})
  }
}

test.describe.configure({ mode: 'serial' })

for (const role of ROLES) {
  test(`focused probe ${role.id}`, async ({ page }, testInfo) => {
    test.setTimeout(10 * 60_000)
    const notes: string[] = []

    page.on('pageerror', (e) => notes.push(`PAGEERROR ${e.message.slice(0, 160)}`))
    page.on('console', (m) => {
      if (m.type() === 'error') notes.push(`CONSOLE ${m.text().slice(0, 160)}`)
    })

    await login(page, role.email)

    const bodyText = (await page.locator('body').innerText().catch(() => '')) || ''
    const hasAside = (await page.locator('aside').count()) > 0
    const hasNavLinks = (await page.locator('aside a[href]').count()) > 0
    notes.push(`home=${page.url()} aside=${hasAside} navLinks=${hasNavLinks} bodyLen=${bodyText.trim().length}`)

    await page.screenshot({ path: testInfo.outputPath(`home-${role.id}.png`), fullPage: true }).catch(() => {})

    expect(hasAside, `${role.id} should render sidebar`).toBeTruthy()
    expect(bodyText.trim().length, `${role.id} home should not be blank`).toBeGreaterThan(40)

    await expandNav(page)
    const nav = await page.$$eval('aside a[href]', (as) =>
      Array.from(
        new Set(
          as.map((a) => {
            const u = new URL((a as HTMLAnchorElement).href)
            return u.pathname + u.search
          }),
        ),
      ),
    )
    notes.push(`NAV ${nav.join(' | ')}`)

    // Probe a few sensitive deep links that shouldn't be needed for non-admins
    const deep = ['/sale-tracking', '/accounts', '/deals', '/tickets', '/users', '/reports', '/erp/invoices', '/whatsapp']
    for (const path of deep) {
      await page.goto(path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      const h1 = ((await page.locator('h1').allInnerTexts().catch(() => [])) || []).join(' ')
      const body = (await page.locator('body').innerText().catch(() => '')) || ''
      let state = 'ok'
      if (/Admin access required|Billing access required|Inventory access required|Access required|You do not have access/i.test(h1 + body))
        state = 'denied'
      else if (/Page not found/i.test(h1)) state = 'notfound'
      else if (/Something went wrong/i.test(h1)) state = 'crash'
      else if (page.url().includes('/login')) state = 'logged_out'
      notes.push(`DEEP ${path} => ${state} final=${new URL(page.url()).pathname}`)
    }

    // Button smoke on home + first few nav destinations
    const targets = ['/', ...nav.map((n) => n.split('?')[0]).filter((p) => p && p !== '/')].slice(0, 8)
    const dead: string[] = []
    const nonClickable: string[] = []
    for (const target of Array.from(new Set(targets))) {
      await page.goto(target).catch(() => {})
      await page.waitForTimeout(800)
      if (/Admin access required|Billing access required/i.test((await page.locator('body').innerText().catch(() => '')) || '')) continue

      const scope = (await page.locator('main').count()) ? 'main' : 'body'
      const buttons = await page.$$eval(`${scope} button, ${scope} [role="button"]`, (els) =>
        els
          .map((el, i) => {
            const e = el as HTMLElement
            const r = e.getBoundingClientRect()
            const visible = r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'
            const label = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || '')
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 50)
            const disabled = (e as HTMLButtonElement).disabled || e.getAttribute('aria-disabled') === 'true'
            return { i, label, visible, disabled }
          })
          .filter((b) => b.visible && !b.disabled && b.label),
      )

      const seen = new Set<string>()
      let tested = 0
      for (const b of buttons) {
        if (tested >= 12) break
        if (seen.has(b.label) || SKIP.test(b.label)) continue
        seen.add(b.label)
        tested++
        const loc = page.locator(`${scope} button, ${scope} [role="button"]`).nth(b.i)
        const url0 = page.url()
        try {
          await loc.click({ timeout: 2000 })
        } catch {
          nonClickable.push(`${target} :: ${b.label}`)
          continue
        }
        await page.waitForTimeout(500)
        const changed = page.url() !== url0 || (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count()) > 0
        if (!changed) {
          // soft: ignore pure toggle/filter noise by checking toast/sheet too
          const toast = await page.locator('[data-sonner-toast]').count()
          if (!toast) dead.push(`${target} :: ${b.label}`)
        }
        await page.keyboard.press('Escape').catch(() => {})
        if (page.url() !== url0) {
          await page.goto(target).catch(() => {})
          await page.waitForTimeout(400)
        }
      }
      notes.push(`BUTTONS ${target} tested=${tested}`)
    }

    if (dead.length) notes.push(`DEAD ${dead.join(' || ')}`)
    if (nonClickable.length) notes.push(`NONCLICK ${nonClickable.join(' || ')}`)

    await testInfo.attach(`notes-${role.id}.txt`, { body: notes.join('\n'), contentType: 'text/plain' })
    console.log(`\n===== ${role.id} =====\n` + notes.join('\n'))
  })
}
