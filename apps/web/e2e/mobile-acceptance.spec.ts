import { expect, test, type Page } from '@playwright/test'

async function mockEmpty(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ json: { workspaces: [] } }))
}

const mobileViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
]

for (const viewport of mobileViewports) {
  test(`mobile shell at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await mockEmpty(page)
    await page.goto('/')

    await expect(page.getByRole('navigation', { name: '移动端导航' })).toBeVisible()
    await expect(page.getByTestId('mobile-board')).toBeVisible()
    await expect(page.getByTestId('canvas')).toHaveCount(0)
    await expect(page.getByTestId('board-rail')).toHaveCount(0)
    await expect(page.getByTestId('right-panel')).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false)
  })
}

test('tablet keeps canvas and collapses the board', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await mockEmpty(page)
  await page.goto('/')

  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('board-rail')).toBeVisible()
  await expect(page.getByTestId('right-panel')).toBeVisible()
  await expect(page.getByTestId('task-board-overlay')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
})

test('desktop keeps the existing three-pane shell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockEmpty(page)
  await page.goto('/')

  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.getByTestId('board-rail')).toBeVisible()
  await expect(page.getByTestId('right-panel')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)
})
