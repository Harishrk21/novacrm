import { expect, test } from '@playwright/test'
import { loginAsHmsAdmin } from '../helpers/auth'

test.describe('Low machine stock alert', () => {
  test('Open stock dismisses the alert when it is shown', async ({ page }) => {
    await loginAsHmsAdmin(page)

    const alert = page.getByRole('status').filter({ hasText: /stock/i })
    // Data-dependent: skip if warehouse has no empty machine SKUs right now
    const shown = await alert.isVisible().catch(() => false)
    test.skip(!shown, 'No low-stock alert for this admin right now')

    await alert.getByRole('button', { name: 'Open stock' }).click()
    await expect(page).toHaveURL(/\/erp\/stock/)
    await expect(alert).toBeHidden({ timeout: 5_000 })
  })
})
