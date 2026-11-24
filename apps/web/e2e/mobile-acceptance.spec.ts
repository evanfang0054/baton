import { expect, test, type Page } from '@playwright/test'

async function mockEmpty(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ json: { workspaces: [] } }))
}

async function mockTabletWorkspace(page: Page) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/workspaces') {
      return route.fulfill({
        json: {
          workspaces: [
            {
              id: 'w1',
              name: 'demo',
              relPath: 'demo',
              trusted: true,
              projectHooks: 'off',
              trustedAt: 1,
              createdAt: 1,
            },
          ],
        },
      })
    }
    if (path === '/api/workspaces/w1/automation') {
      return route.fulfill({
        json: {
          workspaceId: 'w1',
          trusted: true,
          policy: { autopilot: { enabled: true } },
          policyVersion: 'p1',
          killSwitch: false,
          killSwitchForced: false,
          digestCronUnsupported: false,
        },
      })
    }
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [],
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } })
    if (path === '/api/notices') return route.fulfill({ json: { notices: [] } })
    return route.fulfill({ json: {} })
  })
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
  await mockTabletWorkspace(page)
  await page.goto('/')

  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(page.locator('aside[aria-label="交付列表"]')).toBeVisible()
  await expect(page.getByTestId('right-panel')).toBeVisible()
  await expect(page.getByTestId('task-board-overlay')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)
  await expect(page.getByTestId('automation-status')).toContainText('自动化运行中')
  const header = page.locator('header').first()
  const headerBox = await header.boundingBox()
  expect(headerBox?.height ?? 0).toBeLessThan(110)
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
})

test('desktop keeps the existing three-pane shell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockEmpty(page)
  await page.goto('/')

  await expect(page.getByLabel('交付看板')).toBeVisible()
  await expect(page.locator('aside[aria-label="交付列表"]')).toBeVisible()
  await expect(page.getByTestId('right-panel')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0)
})
