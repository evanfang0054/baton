import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // e2e 不依赖本机 daemon：固定空工作区，保证 CI 与本地一致。
  await page.route('**/api/**', (route) => route.fulfill({ json: { workspaces: [] } }))
})

test('renders the three-pane shell without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')

  await expect(page.getByTestId('board-rail')).toBeVisible()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('right-panel')).toBeVisible()
  await expect(page.getByRole('tab', { name: '总管' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('canvas')).toContainText('尚未选择工作区')
  expect(errors).toEqual([])
})
