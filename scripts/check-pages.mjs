// Isolated-browser smoke test for a production build, including Pages subpaths.
import { chromium, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import JSZip from 'jszip'

const baseUrl = process.argv[2]
if (!baseUrl || !/^https?:\/\//.test(baseUrl) || !baseUrl.endsWith('/')) throw new Error('Provide the complete website URL with a trailing slash')
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()
  const errors = []
  const failedResources = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`) })
  await page.goto(new URL('qpcr/index.html', baseUrl).href)
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  await expect(page).toHaveURL(`${baseUrl}#qpcr`)
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.evaluate(() => sessionStorage.setItem('research-data-workbench-authenticated', '1'))
  await page.reload()
  const navigation = page.getByRole('navigation', { name: '科研工具模式', exact: true })
  await expect(navigation.getByRole('button')).toHaveText(['数据反推生成', 'WB 灰度测量', 'qPCR 数据模拟', 'SPR 数据生成'])
  const frame = page.frameLocator('iframe[title="qPCR 数据模拟工具"]')
  await expect(frame.getByRole('heading', { name: 'qRT-PCR 分组模拟工作台', exact: true })).toBeVisible()
  await expect(frame.getByTestId('well-count')).toHaveText('72 孔')
  await expect(frame.getByRole('combobox', { name: '曲线波动模型', exact: true })).toHaveValue('reference-v1')
  const childUrl = await frame.locator('html').evaluate(() => location.href)
  expect(childUrl).toBe(new URL('qpcr/index.html', baseUrl).href)
  await frame.getByRole('textbox', { name: '项目名称', exact: true }).fill('qPCR 发布验收')
  await navigation.getByRole('button', { name: 'WB 灰度测量', exact: true }).click()
  await expect(page.getByRole('heading', { name: '图像工作区', exact: true })).toBeVisible()
  await navigation.getByRole('button', { name: 'qPCR 数据模拟', exact: true }).click()
  await expect(frame.getByRole('textbox', { name: '项目名称', exact: true })).toHaveValue('qPCR 发布验收')
  const pending = page.waitForEvent('download')
  await frame.getByRole('button', { name: 'XLSX＋原始数据', exact: true }).click()
  const download = await pending
  expect(await download.failure()).toBeNull()
  const zip = await JSZip.loadAsync(await readFile(await download.path()))
  expect(zip.file('raw/SIMULATED-RAW-Plate-1.xlsx')).not.toBeNull()
  expect(zip.file('qPCR 发布验收-SIMULATED.xlsx')).not.toBeNull()
  const raw = await JSZip.loadAsync(await zip.file('raw/SIMULATED-RAW-Plate-1.xlsx').async('uint8array'))
  expect(await raw.file('xl/workbook.xml').async('string')).toContain('Melt Curve Raw Data')
  await frame.getByRole('button', { name: '高级孔板', exact: true }).click()
  await expect(frame.getByLabel('Plate 1 96 孔板', { exact: true })).toBeVisible()
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/qpcr-pages-smoke.png' })
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(errors).toEqual([])
  expect(failedResources).toEqual([])
  console.log(JSON.stringify({ url: baseUrl, status: 'PASS', checks: ['anonymous redirect', 'four-tab order', 'qPCR iframe and assets', '72 wells', 'reference model', 'state retention', 'analysis and raw XLSX download', 'plate view', 'logout'], pageErrors: errors, failedResources }))
} finally {
  await browser.close()
}
