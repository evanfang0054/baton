import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // e2e 不依赖本机 daemon：固定空项目，保证 CI 与本地一致。
  await page.route('**/api/**', (route) => route.fulfill({ json: { workspaces: [] } }))
})

test('renders the project shell without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')

  await expect(page.locator('aside[aria-label="项目与需求"]')).toBeVisible()
  await expect(page.getByTestId('empty-canvas')).toBeVisible()
  await expect(page.getByText('先在左侧新建或选择一个项目')).toBeVisible()
  await expect(page.getByTestId('right-panel')).toBeVisible()
  await expect(page.getByText('精灵总管')).toBeVisible()
  await expect(page.getByRole('tab', { name: '总管' })).toHaveCount(0)
  expect(errors).toEqual([])
})
