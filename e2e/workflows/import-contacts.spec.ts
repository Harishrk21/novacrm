import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:10000/api'
const PASSWORD = process.env.E2E_HMS_PASSWORD ?? 'Demo@12345'

async function uiLogin(page: Page, email: string) {
  await page.goto('/login/hms')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 })
  await page.waitForTimeout(500)
}

async function apiToken(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/login`, {
    data: { email, password: PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
  const j = await res.json()
  return String(j.data?.accessToken ?? j.accessToken)
}

test.describe.configure({ mode: 'serial' })

test('navbar Quick create sits above table headers', async ({ page }) => {
  test.setTimeout(60_000)
  await uiLogin(page, 'sales@hmsenterprises.in')
  await page.goto('/workqueue')
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Quick create' }).click()
  const menu = page.getByText('Quick create', { exact: true }).locator('..')
  await expect(page.getByRole('button', { name: /Sale enquiry/i })).toBeVisible()
  // Menu stacking context must be above sticky table (Related To must not paint through)
  const z = await page
    .locator('div')
    .filter({ has: page.getByRole('button', { name: /Sale enquiry/i }) })
    .evaluateAll((els) =>
      els
        .map((el) => ({
          z: getComputedStyle(el).zIndex,
          text: (el as HTMLElement).innerText?.slice(0, 40),
        }))
        .filter((x) => x.z !== 'auto'),
    )
  const high = z.some((x) => Number(x.z) >= 100)
  expect(high, `expected Quick create panel z>=100, got ${JSON.stringify(z)}`).toBeTruthy()
})

test('admin: Import Contacts tab + panel', async ({ page }) => {
  test.setTimeout(60_000)
  await uiLogin(page, 'admin@hmsenterprises.in')
  await page.goto('/contacts?tab=import')
  await page.waitForTimeout(1200)
  await expect(page.getByRole('heading', { name: 'Import Contacts' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText(/Sales customers/i)).toBeVisible()
  await expect(page.getByText(/Service customers/i)).toBeVisible()
  await expect(page.getByText(/Sample CSV/i).first()).toBeVisible()
})

test('admin: after file upload Next is clickable through field mapping', async ({ page }) => {
  test.setTimeout(90_000)
  await uiLogin(page, 'admin@hmsenterprises.in')
  await page.goto('/contacts?tab=import')
  await expect(page.getByRole('heading', { name: 'Import Contacts' })).toBeVisible({
    timeout: 15_000,
  })

  // Minimal CSV with sample-style headers (name + mobile required for fields step)
  const csv = [
    'Customer Name,Mobile,City,Machine Sold,Serial No',
    'E2E Import Shop,9000012345,Chennai,Platform Scale,E2E-SER-001',
  ].join('\n')

  const next = page.getByRole('button', { name: 'Next' })
  await expect(next).toBeDisabled()

  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-import-sales.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  })

  // Should auto-advance to Actions; Next must not stay locked on AI mapping
  await expect(page.getByRole('heading', { name: 'Import actions' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(next).toBeEnabled({ timeout: 10_000 })
  await next.click() // → Module mapping

  await expect(page.getByRole('heading', { name: 'Module — file mapping' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(next).toBeEnabled()
  await next.click() // → Field mapping

  await expect(page.getByRole('heading', { name: 'Field mapping' })).toBeVisible({
    timeout: 10_000,
  })
  // Local heuristics map Customer Name + Mobile immediately
  await expect(next).toBeEnabled({ timeout: 15_000 })
  await next.click() // → Review & import

  await expect(page.getByRole('button', { name: /Import 1 sales rows/i })).toBeVisible({
    timeout: 10_000,
  })
})

test('admin: AI maps arbitrary client headers using sample cell values', async ({ page }) => {
  test.setTimeout(90_000)
  await uiLogin(page, 'admin@hmsenterprises.in')
  await page.goto('/contacts?tab=import')
  await expect(page.getByRole('heading', { name: 'Import Contacts' })).toBeVisible({
    timeout: 15_000,
  })

  // Deliberately non-template headers — mapping must use sample values
  const csv = [
    'Party,Contact No,Mail ID,Town,Item,SNO,Cover',
    'E2E Weird Headers Shop,9111122233,weird@example.com,Madurai,Table Top 30kg,HMS-E2E-99,GC',
  ].join('\n')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-client-sales.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  })

  await expect(page.getByRole('heading', { name: 'Import actions' })).toBeVisible({
    timeout: 15_000,
  })
  const next = page.getByRole('button', { name: 'Next' })
  await next.click()
  await expect(page.getByRole('heading', { name: 'Module — file mapping' })).toBeVisible()
  await next.click()
  await expect(page.getByRole('heading', { name: 'Field mapping' })).toBeVisible({
    timeout: 10_000,
  })

  // Wait for local and/or AI mapping to settle with name + phone
  await expect(next).toBeEnabled({ timeout: 25_000 })
  await expect(page.getByText('Party', { exact: true })).toBeVisible()
  await expect(page.getByText('Contact No', { exact: true })).toBeVisible()
  // Sample values visible in the mapping table
  await expect(page.getByText('E2E Weird Headers Shop')).toBeVisible()
  await expect(page.getByText('9111122233')).toBeVisible()
})

test('desk: Import Contacts available; sales: not', async ({ page, request }) => {
  test.setTimeout(90_000)

  // API: desk allowed, sales forbidden
  const deskTok = await apiToken(request, 'desk@hmsenterprises.in')
  const salesTok = await apiToken(request, 'sales@hmsenterprises.in')
  const deskRes = await request.post(`${API}/contacts/import`, {
    headers: { Authorization: `Bearer ${deskTok}` },
    data: { source: 'sales', rows: [] },
  })
  // empty rows → 422 validation, not 403
  expect([422, 400].includes(deskRes.status()), `desk import status ${deskRes.status()}`).toBeTruthy()

  const salesRes = await request.post(`${API}/contacts/import`, {
    headers: { Authorization: `Bearer ${salesTok}` },
    data: {
      source: 'sales',
      rows: [{ name: 'X', phone: '9876543210' }],
    },
  })
  expect(salesRes.status(), 'sales must not import').toBe(403)

  await uiLogin(page, 'desk@hmsenterprises.in')
  await page.goto('/contacts')
  await page.waitForTimeout(1000)
  await expect(page.getByRole('button', { name: 'Import Contacts' }).or(page.getByRole('tab', { name: /Import Contacts/i }))).toBeVisible()

  await page.goto('/login/hms')
  await page.evaluate(() => localStorage.clear())
  await uiLogin(page, 'sales@hmsenterprises.in')
  await page.goto('/contacts?tab=import')
  await page.waitForTimeout(1200)
  // Deep link blocked — stay on directory, no import heading
  await expect(page.getByRole('heading', { name: 'Import Contacts' })).toHaveCount(0)
  const importTab = page.getByRole('button', { name: 'Import Contacts' })
  await expect(importTab).toHaveCount(0)
})
