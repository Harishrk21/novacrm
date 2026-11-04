import { expect, test, type Page } from '@playwright/test'

/**
 * Smoke: each HMS role can open its core pages and click primary CTAs.
 * Run: npx playwright test e2e/workflows/role-smoke.spec.ts
 */
const PASSWORD = process.env.E2E_HMS_PASSWORD ?? 'Demo@12345'

async function login(page: Page, email: string) {
  await page.goto('/login/hms')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45_000 })
  await page.waitForTimeout(600)
}

function denied(text: string) {
  return /Admin access required|You do not have access|Inventory access required|Billing access required|Page not found|Something went wrong/i.test(
    text,
  )
}

test.describe.configure({ mode: 'serial' })

test('admin: products Add product drawer Save is clickable', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page, 'admin@hmsenterprises.in')
  await page.goto('/erp/products?open=1')
  await page.waitForTimeout(1200)
  const save = page.getByRole('button', { name: 'Save product' })
  await expect(save).toBeVisible()
  // Regression: stock alert used to sit at same z-index and steal this click
  await save.click({ timeout: 5000 })
  await page.waitForTimeout(800)
  // Empty form → validation toast; click itself must succeed
  await expect(page.getByText(/Select machine type|Type the model|Machine product/i).first()).toBeVisible({
    timeout: 5_000,
  })
})

test('sales: sale-tracking + activities + my-tasks + create lead form', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page, 'sales@hmsenterprises.in')

  await page.goto('/sale-tracking')
  await page.waitForTimeout(800)
  expect(denied(await page.locator('body').innerText())).toBeFalsy()

  await page.goto('/sale-tracking?open=1')
  await page.waitForTimeout(1000)
  await expect(page.locator('#lead-field-name')).toBeVisible({ timeout: 10_000 })

  await page.goto('/activities')
  await page.waitForTimeout(900)
  const act = await page.locator('body').innerText()
  expect(act, 'sales should access /activities').not.toMatch(/Admin access required/i)
  expect(denied(act)).toBeFalsy()

  await page.goto('/my-tasks')
  await page.waitForTimeout(700)
  expect(denied(await page.locator('body').innerText())).toBeFalsy()

  await page.goto('/erp/products?open=1')
  await page.waitForTimeout(1000)
  await expect(page.getByRole('button', { name: 'Save product' })).toBeVisible()
})

test('desk: tickets list + new ticket wizard', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page, 'desk@hmsenterprises.in')
  await page.goto('/tickets')
  await page.waitForTimeout(900)
  expect(denied(await page.locator('body').innerText())).toBeFalsy()

  await page.goto('/tickets?open=1&job=service')
  await page.waitForTimeout(1200)
  await expect(page.getByRole('heading', { name: /New service ticket/i })).toBeVisible({
    timeout: 15_000,
  })
  // Primary wizard controls present
  await expect(page.getByRole('button', { name: /Next|Create ticket|Save/i }).first()).toBeVisible()
})

test('engineer: workqueue + open to accept + claimable path', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page, 'engineer@hmsenterprises.in')
  await page.goto('/')
  await page.waitForTimeout(900)
  expect(denied(await page.locator('body').innerText())).toBeFalsy()

  // PWA tip dismiss should work
  const dismiss = page.getByRole('button', { name: 'Dismiss' })
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ timeout: 3000 })
    await page.waitForTimeout(300)
  }
  const notNow = page.getByRole('button', { name: 'Not now' })
  if (await notNow.isVisible().catch(() => false)) {
    await notNow.click({ timeout: 3000 })
  }

  const openAccept = page.getByRole('link', { name: /Open to accept/i }).first()
  if (await openAccept.isVisible().catch(() => false)) {
    await openAccept.click()
    await page.waitForURL(/workqueue/, { timeout: 15_000 })
  } else {
    await page.goto('/workqueue')
  }
  await page.waitForTimeout(1000)
  expect(denied(await page.locator('body').innerText())).toBeFalsy()
  await expect(page.getByRole('complementary').first()).toBeVisible()
  await expect(page.getByText(/Open to accept|My Open|Workqueue|Today/i).first()).toBeVisible()
})
