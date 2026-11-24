import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: { workspaces: [] } }))
})

test.describe('mobile shell', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('renders navigation and no canvas', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('navigation', { name: '移动端导航' })).toBeVisible()
    await expect(page.getByTestId('mobile-board')).toBeVisible()
    await expect(page.getByTestId('canvas')).toHaveCount(0)
    await expect(page.getByTestId('board-rail')).toHaveCount(0)
    await expect(page.getByTestId('right-panel')).toHaveCount(0)

    await page.getByRole('button', { name: '总管', exact: true }).click()
    await expect(page.getByRole('button', { name: '总管', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflow).toBe(false)
  })
})

test.describe('compact desktop', () => {
  test.use({ viewport: { width: 820, height: 1180 } })

  test('keeps the canvas and collapses the board by default', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByLabel('交付看板')).toBeVisible()
    await expect(page.locator('aside[aria-label="交付列表"]')).toBeVisible()
    await expect(page.getByTestId('right-panel')).toBeVisible()
    await expect(page.getByTestId('task-board-overlay')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflow).toBe(false)
  })
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('does not render the mobile navigation', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByLabel('交付看板')).toBeVisible()
    await expect(page.getByTestId('right-panel')).toBeVisible()
    await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)
  })
})
