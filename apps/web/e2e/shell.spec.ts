import { expect, test } from '@playwright/test'

test('renders the three panels without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')

  await expect(page.getByTestId('kanban')).toBeVisible()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('supervisor')).toBeVisible()
  expect(errors).toEqual([])
})
