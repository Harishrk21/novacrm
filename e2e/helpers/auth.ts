import type { Page } from '@playwright/test'

export const DEMO_HMS_ADMIN = {
  email: process.env.E2E_HMS_ADMIN_EMAIL ?? 'admin@hmsenterprises.in',
  password: process.env.E2E_HMS_ADMIN_PASSWORD ?? 'Demo@12345',
} as const

/** Company workspace login via HMS branded path (not the slug gateway). */
export async function loginAsHmsAdmin(page: Page) {
  await page.goto('/login/hms')
  await page.locator('input[type="email"]').fill(DEMO_HMS_ADMIN.email)
  await page.locator('input[type="password"]').fill(DEMO_HMS_ADMIN.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
}
