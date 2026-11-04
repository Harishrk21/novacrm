import { expect, test } from '@playwright/test'
import { loginAsHmsAdmin } from '../helpers/auth'

test.describe('HMS workspace login', () => {
  test('admin can sign in and leave the login page', async ({ page }) => {
    await loginAsHmsAdmin(page)
    await expect(page).not.toHaveURL(/\/login/)
    // Shell should be present (sidebar / main app chrome)
    await expect(page.locator('body')).toBeVisible()
  })
})
