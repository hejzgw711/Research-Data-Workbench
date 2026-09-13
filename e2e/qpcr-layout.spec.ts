import { expect, test as base, type Page } from '@playwright/test'

const frameSelector = 'iframe[title="qPCR 数据模拟工具"]'
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await use(errors)
    expect(errors, 'Layout changes must not introduce browser errors').toEqual([])
  }, { auto: true }],
})

async function openQpcr(page: Page) {
  await page.addInitScript(() => {
    if (window.parent === window) sessionStorage.setItem('research-data-workbench-authenticated', '1')
  })
  await page.goto('/#qpcr')
  const qpcr = page.frameLocator(frameSelector)
  await expect(qpcr.getByTestId('well-count')).toHaveText('72 孔')
  await qpcr.locator('html').evaluate(element => {
    const style = document.createElement('style')
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'
    element.appendChild(style)
  })
  return qpcr
}

function navigation(page: Page) {
  return page.getByRole('navigation', { name: '科研工具模式', exact: true })
}

async function changeMode(page: Page, name: string) {
  await navigation(page).getByRole('button', { name, exact: true }).click()
}

async function frameHeight(page: Page) {
  return (await page.locator(frameSelector).boundingBox())!.height
}

test('wheel over qPCR scrolls the document, scrolls the header away, and pins the common navigation', async ({ page }) => {
  const qpcr = await openQpcr(page)
  await expect.poll(() => frameHeight(page)).toBeGreaterThan(page.viewportSize()!.height)
  await page.evaluate(() => window.scrollTo(0, 0))
  const frame = (await page.locator(frameSelector).boundingBox())!
  await page.mouse.move(frame.x + frame.width * 0.75, Math.min(frame.y + 240, page.viewportSize()!.height - 80))
  await page.mouse.wheel(0, 650)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400)
  expect(await qpcr.locator('html').evaluate(() => window.scrollY)).toBe(0)
  await expect.poll(async () => (await navigation(page).boundingBox())!.y).toBeCloseTo(0, 0)
  const header = (await page.locator('.qpcr-host .workbench-header').boundingBox())!
  expect(header.y + header.height).toBeLessThanOrEqual(0)
  await expect.poll(() => qpcr.locator('html').evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(2)
  await page.screenshot({ path: 'test-results/qpcr-layout-scrolled.png' })
})

test('qPCR uses the centered workbench width and aligns configuration and preview cards', async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 1200 })
  const qpcr = await openQpcr(page)
  const shell = (await qpcr.locator('.app-shell').boundingBox())!
  expect(shell.width).toBeLessThanOrEqual(1780)
  expect(shell.width).toBeGreaterThan(1700)
  expect(Math.abs(shell.x + shell.width / 2 - page.viewportSize()!.width / 2)).toBeLessThanOrEqual(2)
  const generation = (await qpcr.locator('.generation-card').boundingBox())!
  const configuration = (await qpcr.locator('.configuration-column').boundingBox())!
  const results = (await qpcr.locator('.results-column').boundingBox())!
  expect(Math.abs(configuration.x - generation.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(results.x + results.width - generation.x - generation.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(configuration.y - results.y)).toBeLessThanOrEqual(1)
  expect(results.width / configuration.width).toBeGreaterThan(0.85)
  expect(results.width / configuration.width).toBeLessThan(1.2)
  await page.screenshot({ path: 'test-results/qpcr-layout-desktop.png' })
})

test('all tools share the theme without changing their data', async ({ page }) => {
  const qpcr = await openQpcr(page)
  await changeMode(page, 'WB 灰度测量')
  const wb = page.locator('.wb-stage .workbench-header')
  const wbBefore = await wb.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))
  const parentTheme = await page.locator('html').getAttribute('data-theme')
  await changeMode(page, 'qPCR 数据模拟')
  const host = page.locator('.qpcr-host')
  const lightBackground = await host.evaluate(element => getComputedStyle(element).backgroundColor)
  await page.getByRole('button', { name: '切换到深色主题', exact: true }).click()
  await expect(qpcr.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => host.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(lightBackground)
  expect(await page.locator('html').getAttribute('data-theme')).toBe(parentTheme)
  await page.screenshot({ path: 'test-results/qpcr-layout-dark.png' })
  await changeMode(page, 'WB 灰度测量')
  expect(await wb.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))).not.toEqual(wbBefore)
  await changeMode(page, 'SPR 数据生成')
  await expect(page.getByRole('heading', { name: '生成可分析的 SPR 数据', exact: true })).toBeVisible()
  await changeMode(page, 'qPCR 数据模拟')
  await expect(qpcr.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '切换到浅色主题', exact: true }).click()
  await expect.poll(() => host.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(lightBackground)
})

test('iframe height grows and shrinks with content rather than retaining a blank scroll tail', async ({ page }) => {
  const qpcr = await openQpcr(page)
  await expect.poll(() => frameHeight(page)).toBeGreaterThan(1500)
  const originalHeight = await frameHeight(page)
  await qpcr.getByRole('button', { name: '高级参数', exact: true }).click()
  await expect.poll(() => frameHeight(page)).toBeGreaterThan(originalHeight + 50)
  await qpcr.getByRole('button', { name: '高级参数', exact: true }).click()
  await expect.poll(async () => Math.abs(await frameHeight(page) - originalHeight)).toBeLessThanOrEqual(3)
  await qpcr.getByRole('button', { name: '高级孔板', exact: true }).click()
  await expect(qpcr.locator('.plate-curves svg')).toHaveCount(2)
  await qpcr.getByRole('button', { name: '分组模拟', exact: true }).click()
  await expect.poll(async () => Math.abs(await frameHeight(page) - originalHeight)).toBeLessThanOrEqual(3)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(qpcr.locator('footer')).toBeInViewport()
  const footer = (await qpcr.locator('footer').boundingBox())!
  expect(page.viewportSize()!.height - footer.y - footer.height).toBeLessThan(100)
})

test('confirmation and notifications remain in the parent viewport below the navigation', async ({ page }) => {
  const qpcr = await openQpcr(page)
  await page.getByRole('button', { name: '新建实验', exact: true }).click()
  const dialog = qpcr.getByRole('dialog', { name: '新建实验？', exact: true })
  await expect(dialog).toBeInViewport()
  const navBox = (await navigation(page).boundingBox())!
  const dialogBox = (await dialog.boundingBox())!
  expect(dialogBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height)
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await page.screenshot({ path: 'test-results/qpcr-layout-dialog.png' })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  // Keep the user's OS clipboard untouched while exercising the real copy feedback.
  await qpcr.locator('html').evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })
  })
  await qpcr.getByRole('button', { name: '复制表格', exact: true }).click()
  const toast = qpcr.getByRole('status')
  await expect(toast).toContainText('已复制表达量表')
  const toastBox = (await toast.boundingBox())!
  const currentNav = (await navigation(page).boundingBox())!
  expect(toastBox.y).toBeGreaterThanOrEqual(currentNav.y + currentNav.height)
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(page.viewportSize()!.height)
})

test('hidden-frame resizing keeps the single-scroll layout within a mobile viewport', async ({ page }) => {
  const qpcr = await openQpcr(page)
  const timeOrigin = await qpcr.locator('html').evaluate(() => performance.timeOrigin)
  await changeMode(page, 'WB 灰度测量')
  await page.setViewportSize({ width: 390, height: 844 })
  await changeMode(page, 'qPCR 数据模拟')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await expect.poll(() => qpcr.locator('html').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  expect(await qpcr.locator('html').evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await page.evaluate(() => window.scrollTo(0, 0))
  const frame = (await page.locator(frameSelector).boundingBox())!
  await page.mouse.move(340, Math.max(400, frame.y + 40))
  await page.mouse.wheel(0, 650)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400)
  expect(await qpcr.locator('html').evaluate(() => window.scrollY)).toBe(0)
  await expect.poll(async () => (await navigation(page).boundingBox())!.y).toBeCloseTo(0, 0)
  await page.screenshot({ path: 'test-results/qpcr-layout-mobile.png' })
  await page.getByRole('button', { name: '新建实验', exact: true }).click()
  const dialog = qpcr.getByRole('dialog', { name: '新建实验？', exact: true })
  await expect(dialog).toBeInViewport()
  const dialogBox = (await dialog.boundingBox())!
  const navBox = (await navigation(page).boundingBox())!
  expect(dialogBox.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(390)
  expect(dialogBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height)
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(844)
})
