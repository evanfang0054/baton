import { expect, test } from '@playwright/test'

test('renders the three-pane shell without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')

  await expect(page.getByTestId('board-rail')).toBeVisible()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('task-detail')).toBeVisible()
  await expect(page.getByText('尚未选择工作区')).toBeVisible()
  expect(errors).toEqual([])
})
