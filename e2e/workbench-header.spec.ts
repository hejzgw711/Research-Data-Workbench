import { expect, test as base, type Page } from '@playwright/test'

const modes = [
  ['数据反推生成', 'stat', ['清空重填', '打开', '保存', '生成方案', '导出 XLSX', '候选 ZIP']],
  ['WB 灰度测量', 'wb', ['一键清空', '示例双图', '保存会话', '导出 CSV']],
  ['qPCR 数据模拟', 'qpcr', ['新建实验', '打开', '保存', '换一批数据', '模拟', 'XLSX＋原始数据', 'CSV ZIP']],
  ['SPR 数据生成', 'spr', ['生成数据', '实验 JSON', '生成完整 SPR Dataset']],
] as const
const test = base.extend<{ errors: string[] }>({
  errors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await use(errors)
    expect(errors).toEqual([])
  }, { auto: true }],
})

async function login(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('research-data-workbench-authenticated', '1'))
  await page.goto('/')
}
async function select(page: Page, name: string) {
  await page.getByRole('navigation', { name: '科研工具模式' }).getByRole('button', { name, exact: true }).click()
  await page.evaluate(() => window.scrollTo(0, 0))
}

for (const width of [1600, 390]) {
  test(`all four tools put global actions above navigation with compact theme controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page)
    let expectedHeaderStyle: unknown
    for (const [name, stage, actions] of modes) {
      await select(page, name)
      const header = page.locator(`.${stage}-stage .workbench-header`)
      const nav = page.getByRole('navigation', { name: '科研工具模式' })
      for (const action of actions) await expect(header.getByRole('button', { name: action, exact: true })).toBeVisible()
      const bounds = (await header.boundingBox())!
      const navBounds = (await nav.boundingBox())!
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(navBounds.y + 1)
      for (const button of await header.getByRole('button').all()) {
        const box = (await button.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(bounds.x)
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width)
        expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height)
      }
      const theme = header.getByRole('button', { name: '切换到深色主题', exact: true })
      await expect(theme).toHaveText('')
      await expect(theme).toHaveAttribute('title', '切换到深色主题')
      const size = (await theme.boundingBox())!
      expect(size.width).toBe(36)
      expect(size.height).toBe(36)
      const style = await header.evaluate(element => {
        const computed = getComputedStyle(element)
        return [computed.backgroundColor, computed.color, computed.borderRadius, computed.padding]
      })
      if (expectedHeaderStyle) expect(style).toEqual(expectedHeaderStyle)
      else expectedHeaderStyle = style
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      await page.screenshot({ path: `test-results/header-${stage}-light-${width}.png`, animations: 'disabled' })
      await theme.click()
      await expect(page.locator('.combined-shell')).toHaveAttribute('data-theme', 'dark')
      await expect.poll(() => nav.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(7, 24, 23)')
      if (stage === 'qpcr') await expect(page.frameLocator('iframe[title="qPCR 数据模拟工具"]').locator('html')).toHaveAttribute('data-theme', 'dark')
      await page.screenshot({ path: `test-results/header-${stage}-dark-${width}.png`, animations: 'disabled' })
      await header.getByRole('button', { name: '切换到浅色主题', exact: true }).click()
    }
  })
}

test('theme is shared across tools, survives reload, and leaves qPCR values and seed unchanged', async ({ page }) => {
  await login(page)
  await select(page, 'qPCR 数据模拟')
  const qpcr = page.frameLocator('iframe[title="qPCR 数据模拟工具"]')
  await expect(qpcr.getByTestId('well-count')).toHaveText('72 孔')
  const table = await qpcr.getByTestId('expression-table').textContent()
  const seed = await qpcr.getByRole('spinbutton', { name: '随机种子', exact: true }).inputValue()
  await page.getByRole('button', { name: '切换到深色主题', exact: true }).click()
  await expect(qpcr.locator('html')).toHaveAttribute('data-theme', 'dark')
  for (const [name] of modes) {
    await select(page, name)
    await expect(page.getByRole('button', { name: '切换到浅色主题', exact: true })).toBeVisible()
    await expect(page.locator('.combined-shell')).toHaveAttribute('data-theme', 'dark')
  }
  await select(page, 'qPCR 数据模拟')
  await expect(qpcr.getByTestId('expression-table')).toHaveText(table!)
  await expect(qpcr.getByRole('spinbutton', { name: '随机种子', exact: true })).toHaveValue(seed)
  await page.reload()
  await expect(qpcr.locator('html')).toHaveAttribute('data-theme', 'dark')
  const toggle = page.getByRole('button', { name: '切换到浅色主题', exact: true })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(qpcr.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('research-data-workbench-theme'))).toBe('light')
})

test('qPCR toolbar opens its file picker and re-simulates without changing seeded values', async ({ page }) => {
  await login(page)
  await select(page, 'qPCR 数据模拟')
  const qpcr = page.frameLocator('iframe[title="qPCR 数据模拟工具"]')
  const header = page.locator('.qpcr-host .workbench-header')
  await expect(header.getByRole('button', { name: '打开', exact: true })).toBeVisible()
  const table = await qpcr.getByTestId('expression-table').textContent()
  await header.getByRole('button', { name: '模拟', exact: true }).click()
  await expect(qpcr.getByTestId('expression-table')).toHaveText(table!)
  const chooser = page.waitForEvent('filechooser')
  await header.getByRole('button', { name: '打开', exact: true }).click()
  expect((await chooser).isMultiple()).toBe(false)
  await header.getByRole('button', { name: '新建实验', exact: true }).click()
  const dialog = qpcr.getByRole('dialog', { name: '新建实验？', exact: true })
  await expect(dialog).toBeInViewport()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(qpcr.getByTestId('expression-table')).toHaveText(table!)
})
