import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * End-to-end HMS role workflows (API + UI):
 *  1) Sales — login, nav, sale-tracking, create lead (API), deals/activities
 *  2) Desk — login, create OPEN ticket, awaiting queue
 *  3) Engineer — claim ticket, open detail, wrong-role deep links
 *
 * Run: npx playwright test e2e/workflows/role-workflows.spec.ts
 */
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:10000/api'
const PASSWORD = process.env.E2E_HMS_PASSWORD ?? 'Demo@12345'
const OUT = path.join('e2e', 'workflows', 'out')

type LoginResult = { token: string; userId: string; role: string }

async function apiLogin(request: APIRequestContext, email: string): Promise<LoginResult> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email, password: PASSWORD },
  })
  expect(res.ok(), `API login ${email}`).toBeTruthy()
  const body = await res.json()
  const token = body.data?.accessToken ?? body.accessToken
  const user = body.data?.user ?? body.user
  expect(token, `token for ${email}`).toBeTruthy()
  return {
    token: String(token),
    userId: String(user?.id ?? ''),
    role: String(user?.role ?? user?.roleKey ?? ''),
  }
}

async function uiLogin(page: Page, email: string) {
  await page.goto('/login/hms')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 })
  await page.waitForTimeout(600)
}

async function expandNav(page: Page) {
  const buttons = page.locator('aside nav button, aside button')
  const n = await buttons.count()
  for (let i = 0; i < Math.min(n, 12); i++) {
    const b = buttons.nth(i)
    const label = ((await b.innerText().catch(() => '')) || '').trim()
    if (/collapse|log ?out|account menu/i.test(label)) continue
    const rotated = await b.locator('svg.rotate-180').count()
    if (!rotated) await b.click({ timeout: 600 }).catch(() => {})
  }
  await page.waitForTimeout(250)
}

async function collectNav(page: Page) {
  await expandNav(page)
  return page.$$eval('aside a[href]', (as) =>
    Array.from(new Set(as.map((a) => new URL((a as HTMLAnchorElement).href).pathname))),
  )
}

function saveReport(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2))
}

function denied(text: string) {
  return /Admin access required|You do not have access|Page not found|Billing access required|Inventory access required/i.test(
    text,
  )
}

test.describe.configure({ mode: 'serial' })

test.describe('HMS role workflows', () => {
  let deskTicketId = ''
  let deskSubject = ''
  const findings: Record<string, string[]> = { sales: [], desk: [], engineer: [] }

  test('1) Sales workflow', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000)
    const email = 'sales@hmsenterprises.in'
    const api = await apiLogin(request, email)
    findings.sales.push(`apiLogin role=${api.role || 'unknown'} userId=${api.userId || '?'}`)

    await uiLogin(page, email)
    await expect(page.locator('aside')).toBeVisible({ timeout: 20_000 })
    findings.sales.push(`home=${page.url()}`)

    const nav = await collectNav(page)
    findings.sales.push(`nav=${nav.join('|')}`)
    expect(
      nav.some((p) => /sale-tracking|leads|deal|contact|activit/i.test(p)),
      'sales nav has CRM paths',
    ).toBeTruthy()
    expect(nav.includes('/users'), 'sales should not see Users').toBeFalsy()

    await page.goto('/sale-tracking')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(900)
    let body = (await page.locator('body').innerText()) || ''
    expect(denied(body), 'sale-tracking denied').toBeFalsy()
    expect(body.length).toBeGreaterThan(40)
    findings.sales.push('sale-tracking:ok')

    // Open create form — require contact picker + name field (do not hang on save)
    await page.goto('/sale-tracking?open=1')
    await page.waitForTimeout(1200)
    const nameVisible = await page.locator('#lead-field-name').isVisible().catch(() => false)
    const phoneVisible = await page.locator('#lead-field-phone').isVisible().catch(() => false)
    findings.sales.push(`create-form:name=${nameVisible} phone=${phoneVisible}`)
    expect(nameVisible || phoneVisible, 'lead create form should open').toBeTruthy()

    const stamp = `E2E Sales ${Date.now()}`
    const phone = `9${String(Date.now()).slice(-9)}`
    const leadRes = await request.post(`${API}/leads`, {
      headers: { Authorization: `Bearer ${api.token}` },
      data: {
        name: stamp,
        phone,
        source: 'WEBSITE',
        status: 'NEW',
        area: 'E2E Area',
        city: 'Chennai',
      },
    })
    const leadJson = await leadRes.json().catch(() => ({}))
    findings.sales.push(`create-lead-api:status=${leadRes.status()} id=${leadJson?.data?.id ?? '?'}`)
    expect(leadRes.ok(), `sales create lead: ${JSON.stringify(leadJson).slice(0, 280)}`).toBeTruthy()

    for (const pathName of ['/deals', '/activities', '/my-tasks', '/contacts']) {
      await page.goto(pathName)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      body = (await page.locator('body').innerText()) || ''
      const isDenied = denied(body)
      findings.sales.push(`${pathName}:${isDenied ? 'DENIED' : 'ok'}`)
      // Soft: record wrong denials; hard-fail only on core CRM paths
      if (pathName === '/deals' || pathName === '/contacts') {
        expect(isDenied, `${pathName} usable for sales`).toBeFalsy()
      }
    }

    // Tickets deep-link — note if New ticket appears (wrong-role leak)
    await page.goto('/tickets')
    await page.waitForTimeout(700)
    body = (await page.locator('body').innerText()) || ''
    const newTicketBtn = await page.getByRole('button', { name: /New ticket|Create ticket/i }).count()
    findings.sales.push(
      `tickets-deep:${denied(body) ? 'denied' : 'page-open'} newTicketBtn=${newTicketBtn}`,
    )

    await page.screenshot({ path: testInfo.outputPath('sales.png'), fullPage: true }).catch(() => {})
    saveReport('sales', { findings: findings.sales, nav })
  })

  test('2) Service desk workflow', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000)
    const email = 'desk@hmsenterprises.in'
    const api = await apiLogin(request, email)
    findings.desk.push(`apiLogin role=${api.role || 'unknown'}`)

    await uiLogin(page, email)
    await expect(page.locator('aside')).toBeVisible({ timeout: 20_000 })

    const nav = await collectNav(page)
    findings.desk.push(`nav=${nav.join('|')}`)
    expect(nav.some((p) => p.includes('ticket')), 'desk nav has tickets').toBeTruthy()
    expect(nav.some((p) => p.includes('sale-tracking')), 'desk should not show sale-tracking').toBeFalsy()

    await page.goto('/tickets')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(900)
    let body = (await page.locator('body').innerText()) || ''
    expect(denied(body)).toBeFalsy()
    findings.desk.push('tickets-list:ok')

    deskSubject = `E2E Desk Job ${Date.now()}`
    const createRes = await request.post(`${API}/tickets`, {
      headers: { Authorization: `Bearer ${api.token}` },
      data: {
        subject: deskSubject,
        description: 'Playwright desk workflow — leave unassigned for engineer claim',
        priority: 'MEDIUM',
        status: 'OPEN',
      },
    })
    const createJson = await createRes.json().catch(() => ({}))
    findings.desk.push(`create-ticket-api:status=${createRes.status()}`)
    expect(createRes.ok(), `desk create: ${JSON.stringify(createJson).slice(0, 300)}`).toBeTruthy()
    deskTicketId = String(createJson?.data?.id ?? createJson?.id ?? '')
    expect(deskTicketId).toBeTruthy()
    findings.desk.push(`ticketId=${deskTicketId} ticketNo=${createJson?.data?.ticketNo ?? '?'}`)

    await page.goto('/tickets?open=1&job=service')
    await page.waitForTimeout(1500)
    // Create UI uses tabs ("New ticket") rather than a single Create button
    const newTab = await page.getByRole('button', { name: /New ticket/i }).count()
    const createTab = await page.locator('[role="tab"], button').filter({ hasText: /New ticket|Create/i }).count()
    const formBits =
      (await page.locator('textarea').count()) +
      (await page.getByText(/Customer|Machine|Issue|Priority|Service job/i).count())
    const formVisible = newTab > 0 || createTab > 0 || formBits > 0
    findings.desk.push(`new-ticket-ui:formVisible=${formVisible} newTab=${newTab} formBits=${formBits}`)
    // Soft record — API create already proved write permission
    if (!formVisible) findings.desk.push('WARN: create form not detected via ?open=1')

    await page.goto('/tickets?queue=awaiting')
    await page.waitForTimeout(1200)
    body = (await page.locator('body').innerText()) || ''
    const found = body.includes(deskSubject) || body.includes(deskTicketId.slice(0, 8))
    findings.desk.push(`awaiting-queue:found=${found}`)

    const acceptCount = await page.getByRole('button', { name: /^Accept( job)?$/i }).count()
    findings.desk.push(`accept-buttons-on-awaiting=${acceptCount}`)

    await page.goto('/sale-tracking')
    await page.waitForTimeout(700)
    body = (await page.locator('body').innerText()) || ''
    findings.desk.push(`sale-tracking-deep:${denied(body) ? 'denied' : 'OPEN_LEAK'}`)

    await page.screenshot({ path: testInfo.outputPath('desk.png'), fullPage: true }).catch(() => {})
    saveReport('desk', { findings: findings.desk, deskTicketId, deskSubject })
  })

  test('3) Service engineer workflow', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000)
    const email = 'engineer@hmsenterprises.in'
    const api = await apiLogin(request, email)
    findings.engineer.push(`apiLogin role=${api.role || 'unknown'}`)
    expect(deskTicketId, 'prior desk ticket required').toBeTruthy()

    await uiLogin(page, email)
    await expect(page.locator('aside')).toBeVisible({ timeout: 20_000 })

    const nav = await collectNav(page)
    findings.engineer.push(`nav=${nav.join('|')}`)
    expect(nav.some((p) => /ticket|workqueue/i.test(p)), 'engineer has jobs').toBeTruthy()
    expect(nav.some((p) => p.includes('sale-tracking')), 'engineer no sale-tracking').toBeFalsy()

    await page.goto('/workqueue')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    let body = (await page.locator('body').innerText()) || ''
    expect(denied(body)).toBeFalsy()
    findings.engineer.push('workqueue:ok')

    const claimRes = await request.post(`${API}/tickets/${deskTicketId}/claim`, {
      headers: { Authorization: `Bearer ${api.token}` },
      data: {},
    })
    const claimJson = await claimRes.json().catch(() => ({}))
    findings.engineer.push(`claim-api:status=${claimRes.status()} msg=${claimJson?.message ?? ''}`)
    expect(claimRes.ok(), `engineer claim: ${JSON.stringify(claimJson).slice(0, 300)}`).toBeTruthy()

    await page.goto(`/tickets/${deskTicketId}`)
    await page.waitForTimeout(1200)
    body = (await page.locator('body').innerText()) || ''
    expect(body.length).toBeGreaterThan(40)
    expect(/You do not have access|Page not found|Something went wrong/i.test(body)).toBeFalsy()
    const hasMarkComplete = (await page.getByRole('button', { name: /Mark complete/i }).count()) > 0
    findings.engineer.push(`detail:markComplete=${hasMarkComplete} subjectHit=${body.includes(deskSubject)}`)

    await page.goto('/tickets')
    await page.waitForTimeout(700)
    const newTicketBtn = await page.getByRole('button', { name: /New ticket|Create ticket/i }).count()
    findings.engineer.push(`tickets-list:newTicketBtn=${newTicketBtn}`)

    for (const p of ['/deals', '/sale-tracking', '/accounts']) {
      await page.goto(p)
      await page.waitForTimeout(600)
      body = (await page.locator('body').innerText()) || ''
      findings.engineer.push(`${p}:${denied(body) ? 'denied' : 'OPEN_LEAK'}`)
    }

    await page.screenshot({ path: testInfo.outputPath('engineer.png'), fullPage: true }).catch(() => {})
    saveReport('engineer', { findings: findings.engineer, deskTicketId })
    saveReport('summary', findings)
  })
})
