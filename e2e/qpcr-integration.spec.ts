import { expect, test as base, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'

const authKey = 'research-data-workbench-authenticated'
const frameSelector = 'iframe[title="qPCR 数据模拟工具"]'
const modes = ['数据反推生成', 'WB 灰度测量', 'qPCR 数据模拟', 'SPR 数据生成']

const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await use(errors)
    expect(errors, 'Parent and qPCR iframe must not raise uncaught errors').toEqual([])
  }, { auto: true }],
})

async function authenticate(page: Page, storage: 'localStorage' | 'sessionStorage' = 'sessionStorage') {
  // Exercise the existing browser-only session contract without storing credentials.
  await page.addInitScript(({ key, storageName }) => {
    if (window.parent === window) window[storageName].setItem(key, '1')
  }, { key: authKey, storageName: storage })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '图像工作区', exact: true })).toBeVisible()
}

async function changeMode(page: Page, name: typeof modes[number]) {
  await page.getByRole('navigation', { name: '科研工具模式', exact: true })
    .getByRole('button', { name, exact: true }).click()
}

async function openQpcr(page: Page) {
  await changeMode(page, 'qPCR 数据模拟')
  const qpcr = page.frameLocator(frameSelector)
  await expect(qpcr.getByRole('heading', { name: 'qRT-PCR 分组模拟工作台', exact: true })).toBeVisible()
  await qpcr.locator('html').evaluate(element => {
    const style = document.createElement('style')
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'
    element.appendChild(style)
  })
  await expect(qpcr.getByTestId('well-count')).toHaveText('72 孔')
  return qpcr
}

async function downloadFromQpcr(page: Page, name: string) {
  const pending = page.waitForEvent('download')
  await page.frameLocator(frameSelector).getByRole('button', { name, exact: true }).click()
  const download = await pending
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  expect(path).not.toBeNull()
  return { name: download.suggestedFilename(), bytes: await readFile(path!) }
}

test('anonymous visitors cannot mount qPCR, including direct child-page URLs', async ({ page }) => {
  for (const path of ['/', '/qpcr/', '/qpcr/index.html']) {
    await page.goto(path)
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '账号', exact: true })).toBeVisible()
    await expect(page.locator(frameSelector)).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '科研工具模式', exact: true })).toHaveCount(0)
    if (path !== '/') await expect(page).toHaveURL(/\/#qpcr$/)
  }
})

for (const storage of ['sessionStorage', 'localStorage'] as const) {
  test(`${storage} sessions open the fourth-tool layout and the same-origin qPCR tool`, async ({ page }) => {
    await authenticate(page, storage)
    await expect(page.getByRole('navigation', { name: '科研工具模式', exact: true }).getByRole('button')).toHaveText(modes)
    await expect(page.locator(frameSelector)).toHaveCount(0)
    const qpcr = await openQpcr(page)
    await expect(page.getByRole('navigation', { name: '科研工具模式', exact: true }).getByRole('button')).toHaveText(modes)
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
    await expect(qpcr.getByRole('combobox', { name: '曲线波动模型', exact: true })).toHaveValue('reference-v1')
    const childUrl = await qpcr.locator('html').evaluate(() => window.location.href)
    expect(new URL(childUrl).origin).toBe(new URL(page.url()).origin)
    expect(new URL(childUrl).pathname).toBe('/qpcr/index.html')
    await expect(page.locator(frameSelector)).toHaveAttribute('allow', 'clipboard-write')
    await page.goto('/qpcr/')
    await expect(page).toHaveURL(/\/#qpcr$/)
    await expect(qpcr.getByTestId('well-count')).toHaveText('72 孔')
  })
}

test('switching modes preserves qPCR inputs, selected plate and iframe while isolating its theme', async ({ page }) => {
  await authenticate(page)
  const wbHeader = page.locator('.wb-stage .topbar')
  const wbStyle = await wbHeader.evaluate(element => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }))
  const qpcr = await openQpcr(page)
  const timeOrigin = await qpcr.locator('html').evaluate(() => performance.timeOrigin)
  const parentTheme = await page.locator('html').getAttribute('data-theme')
  const hostStyle = await page.locator('.qpcr-host-header').evaluate(element => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }))
  await qpcr.getByRole('textbox', { name: '项目名称', exact: true }).fill('集成状态保持验收')
  await qpcr.getByRole('spinbutton', { name: '随机种子', exact: true }).fill('20260913')
  await qpcr.getByRole('spinbutton', { name: '随机种子', exact: true }).press('Tab')
  const expression = (await qpcr.getByTestId('expression-table').textContent())!
  await qpcr.getByRole('button', { name: '深色主题', exact: true }).click()
  await expect(qpcr.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.locator('html').getAttribute('data-theme')).toBe(parentTheme)
  expect(await page.locator('.qpcr-host-header').evaluate(element => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }))).toEqual(hostStyle)
  await qpcr.getByRole('button', { name: '高级孔板', exact: true }).click()
  await expect(qpcr.locator('.plate-well')).toHaveCount(96)
  await expect(qpcr.locator('.plate-well.assigned')).toHaveCount(72)
  await qpcr.getByRole('button', { name: /^A2 CTRL ACTIN Cq / }).click()
  await changeMode(page, 'WB 灰度测量')
  await expect(page.locator(frameSelector)).toHaveCount(1)
  await expect(page.locator(frameSelector)).toBeHidden()
  expect(await wbHeader.evaluate(element => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }))).toEqual(wbStyle)
  await changeMode(page, 'qPCR 数据模拟')
  expect(await qpcr.locator('html').evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await expect(qpcr.getByRole('textbox', { name: '项目名称', exact: true })).toHaveValue('集成状态保持验收')
  await expect(qpcr.getByRole('spinbutton', { name: '随机种子', exact: true })).toHaveValue('20260913')
  await expect(qpcr.locator('.plate-well.selected')).toContainText('A2')
  await expect(qpcr.locator('.plate-curves svg')).toHaveCount(2)
  await qpcr.getByRole('button', { name: '分组模拟', exact: true }).click()
  await expect(qpcr.getByTestId('expression-table')).toHaveText(expression)
  await qpcr.getByRole('button', { name: '浅色主题', exact: true }).click()
  await expect(qpcr.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.screenshot({ path: 'test-results/qpcr-integration-desktop.png', fullPage: true })
})

test('iframe downloads include analysis XLSX, full raw XLSX and raw CSV files', async ({ page }) => {
  await authenticate(page)
  await openQpcr(page)
  const xlsx = await downloadFromQpcr(page, 'XLSX＋原始数据')
  expect(xlsx.name).toMatch(/-SIMULATED-XLSX-RAW\.zip$/)
  const bundle = await JSZip.loadAsync(xlsx.bytes)
  const analysisName = Object.keys(bundle.files).find(name => !name.startsWith('raw/') && name.endsWith('-SIMULATED.xlsx'))
  expect(analysisName).toBeDefined()
  const analysis = await JSZip.loadAsync(await bundle.file(analysisName!)!.async('uint8array'))
  expect(await analysis.file('xl/workbook.xml')!.async('string')).toContain('Raw Cq')
  const rawFile = bundle.file('raw/SIMULATED-RAW-Plate-1.xlsx')
  expect(rawFile).not.toBeNull()
  const raw = await JSZip.loadAsync(await rawFile!.async('uint8array'))
  const workbookXml = await raw.file('xl/workbook.xml')!.async('string')
  for (const sheet of ['Summary', 'Sample Setup', 'Amplification Data', 'Melt Curve Raw Data', 'Melt Curve Result', 'Results']) {
    expect(workbookXml).toContain(`name="${sheet}"`)
  }
  expect(await bundle.file('README-SIMULATED.txt')!.async('string')).toContain('SIMULATED RAW DATA')
  const csv = await downloadFromQpcr(page, 'CSV ZIP')
  const csvBundle = await JSZip.loadAsync(csv.bytes)
  expect(csvBundle.file('cq.csv')).not.toBeNull()
  expect(await csvBundle.file('metadata.csv')!.async('string')).toContain('SIMULATED')
  for (const name of ['metadata', 'sample-setup', 'amplification', 'melt-raw', 'melt-result', 'results']) {
    expect(csvBundle.file(`raw/Plate-1/${name}.csv`), name).not.toBeNull()
  }
  for (const [name, expectedRows] of [['sample-setup', 72], ['amplification', 72 * 40], ['melt-raw', 72 * 176]] as const) {
    const text = await csvBundle.file(`raw/Plate-1/${name}.csv`)!.async('string')
    expect(text.trimEnd().split(/\r?\n/)).toHaveLength(expectedRows + 1)
  }
})

test('project round-trip, image export, copied table and confirmation dialog work inside the iframe', async ({ page }) => {
  await authenticate(page)
  const qpcr = await openQpcr(page)
  await qpcr.getByRole('textbox', { name: '项目名称', exact: true }).fill('iframe 项目验收')
  const original = (await qpcr.getByTestId('expression-table').textContent())!
  const project = await downloadFromQpcr(page, '保存')
  expect(project.name).toMatch(/\.qpcr\.json$/)
  expect(JSON.parse(project.bytes.toString()).simulationAlgorithmVersion).toBe(2)
  await qpcr.getByRole('button', { name: '换一批数据', exact: true }).click()
  await expect(qpcr.getByTestId('expression-table')).not.toHaveText(original)
  await qpcr.getByLabel('打开项目文件', { exact: true }).setInputFiles({ name: 'restored.qpcr.json', mimeType: 'application/json', buffer: project.bytes })
  await expect(qpcr.getByTestId('expression-table')).toHaveText(original)
  await expect(qpcr.getByRole('textbox', { name: '项目名称', exact: true })).toHaveValue('iframe 项目验收')
  const png = await downloadFromQpcr(page, 'PNG')
  expect(png.bytes.subarray(1, 4).toString()).toBe('PNG')
  const svg = await downloadFromQpcr(page, 'SVG')
  expect(svg.bytes.toString()).toContain('<svg')
  expect(svg.bytes.toString()).toContain('SIMULATED')
  // Intercept only this isolated browser's clipboard API, never the user's clipboard.
  await qpcr.locator('html').evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.testClipboard = text },
    } })
  })
  await qpcr.getByRole('button', { name: '复制表格', exact: true }).click()
  await expect(qpcr.getByRole('status')).toContainText('已复制表达量表')
  expect(await qpcr.locator('html').getAttribute('data-test-clipboard')).toContain('SIMULATED')
  const toastBox = await qpcr.getByRole('status').boundingBox()
  expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await qpcr.getByRole('button', { name: '新建实验', exact: true }).click()
  const dialog = qpcr.getByRole('dialog', { name: '新建实验？', exact: true })
  await expect(dialog).toBeInViewport()
  const dialogBox = await dialog.boundingBox()
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(qpcr.getByTestId('expression-table')).toHaveText(original)
})

test('statistics and SPR remain accessible after visiting qPCR', async ({ page }) => {
  await authenticate(page)
  await openQpcr(page)
  await changeMode(page, '数据反推生成')
  await expect(page.getByRole('tablist', { name: '分析模式', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Two-way ANOVA', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重复测量时间序列', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '结果预览', exact: true })).toBeVisible()
  await changeMode(page, 'SPR 数据生成')
  await expect(page.getByRole('heading', { name: '生成可分析的 SPR 数据', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '响应曲线与数据预览', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '科研工具模式', exact: true }).getByRole('button')).toHaveText(modes)
  await changeMode(page, 'WB 灰度测量')
  await expect(page.getByRole('heading', { name: '图像工作区', exact: true })).toBeVisible()
})

test('qPCR responds to hidden-frame resize without document overflow on mobile', async ({ page }) => {
  await authenticate(page)
  const qpcr = await openQpcr(page)
  const chart = qpcr.locator('.expression-chart svg')
  const wideWidth = (await chart.boundingBox())!.width
  const timeOrigin = await qpcr.locator('html').evaluate(() => performance.timeOrigin)
  await changeMode(page, 'WB 灰度测量')
  await page.setViewportSize({ width: 390, height: 844 })
  await changeMode(page, 'qPCR 数据模拟')
  await expect(page.locator(frameSelector)).toBeVisible()
  expect(await qpcr.locator('html').evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await expect.poll(() => qpcr.locator('html').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await expect.poll(async () => (await chart.boundingBox())!.width).toBeLessThan(wideWidth)
  expect((await chart.boundingBox())!.width).toBeGreaterThan(250)
  expect(await chart.innerHTML()).not.toContain('NaN')
  await page.screenshot({ path: 'test-results/qpcr-integration-mobile.png', fullPage: true })
  await qpcr.getByRole('button', { name: '高级孔板', exact: true }).click()
  await expect(qpcr.locator('.plate-curves svg')).toHaveCount(2)
  await expect.poll(() => qpcr.locator('html').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  for (const curve of await qpcr.locator('.plate-curves svg').all()) {
    expect((await curve.boundingBox())!.width).toBeGreaterThan(200)
    expect(await curve.innerHTML()).not.toContain('NaN')
  }
  await changeMode(page, 'WB 灰度测量')
  await page.setViewportSize({ width: 1600, height: 1000 })
  await changeMode(page, 'qPCR 数据模拟')
  await expect(qpcr.locator('.plate-curves svg')).toHaveCount(2)
  await qpcr.getByRole('button', { name: '分组模拟', exact: true }).click()
  await expect.poll(async () => (await chart.boundingBox())!.width).toBeGreaterThan(390)
})

test('logout removes the iframe and both existing browser session flags', async ({ page }) => {
  await authenticate(page)
  await openQpcr(page)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  await expect(page.locator(frameSelector)).toHaveCount(0)
  expect(await page.evaluate(key => [localStorage.getItem(key), sessionStorage.getItem(key)], authKey)).toEqual([null, null])
})
