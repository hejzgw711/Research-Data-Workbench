import { expect, test as base, type Download, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'

const displayMarker = /synthetic|simulated|模拟数据|合成数据/i
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await use(errors)
    expect(errors, 'Export workflows must not raise browser or console errors').toEqual([])
  }, { auto: true }],
})

async function authenticate(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('research-data-workbench-authenticated', '1')
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '图像工作区', exact: true })).toBeVisible()
}

async function openSpr(page: Page) {
  await authenticate(page)
  await page.getByRole('navigation', { name: '科研工具模式', exact: true })
    .getByRole('button', { name: 'SPR 数据生成', exact: true }).click()
  await expect(page.locator('.spr-mode .summary-grid')).toContainText('8,208')
  return page.locator('.spr-mode')
}

async function downloadBytes(download: Download) {
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  expect(path).not.toBeNull()
  return { name: download.suggestedFilename(), bytes: await readFile(path!) }
}

async function clickDownload(page: Page, button: Locator) {
  const pending = page.waitForEvent('download')
  await button.click()
  return downloadBytes(await pending)
}

function textFile(bytes: Buffer) {
  return bytes.toString('utf8').replace(/^\uFEFF/, '')
}

test('SPR default plot CSV, raw CSV and JSON download without automatic display markers', async ({ page }) => {
  const spr = await openSpr(page)
  const plot = await clickDownload(page, spr.getByRole('button', { name: /^下载作图 CSV/ }))
  const raw = await clickDownload(page, spr.getByRole('button', { name: /^下载原始 CSV/ }))
  const json = await clickDownload(page, spr.getByRole('button', { name: /^实验 JSON/ }))
  expect([plot.name, raw.name, json.name]).toEqual([
    'spr-data-plot.csv', 'spr-data-raw.csv', 'spr-data-experiment.json',
  ])
  for (const file of [plot, raw, json]) {
    expect(file.name).not.toMatch(displayMarker)
    expect(textFile(file.bytes)).not.toMatch(displayMarker)
  }
  const plotRows = textFile(plot.bytes).trimEnd().split(/\r?\n/)
  const rawRows = textFile(raw.bytes).trimEnd().split(/\r?\n/)
  expect(plotRows).toHaveLength(433)
  expect(plotRows[0].split(',')).toHaveLength(15)
  expect(rawRows).toHaveLength(8209)
  expect(rawRows[0].split(',')).toHaveLength(27)
  expect(rawRows[1].split(',').slice(0, 2)).toEqual(['spr-data', 'SPR Run'])
  expect(Number(rawRows[1].split(',')[16])).toBeGreaterThan(0)
  const metadata = JSON.parse(textFile(json.bytes))
  expect(metadata.seed).toBe(20260829)
  expect(metadata.kinetics).toMatchObject({ model: '1:1 Langmuir', ka_M_inv_s_inv: 2500, kd_s_inv: 0.015, Rmax_RU: 800 })
  expect(metadata.cycles).toHaveLength(19)
  await expect(spr.locator('footer')).toContainText('合成数据仅用于科研教学')
})

test('SPR dataset ZIP includes the same CSV values, method notes and neutral JSON', async ({ page }) => {
  const spr = await openSpr(page)
  const raw = await clickDownload(page, spr.getByRole('button', { name: /^下载原始 CSV/ }))
  const dataset = await clickDownload(page, spr.getByRole('button', { name: /^生成完整 SPR Dataset/ }))
  expect(dataset.name).toBe('spr-data-dataset.zip')
  const zip = await JSZip.loadAsync(dataset.bytes)
  for (const [name, entry] of Object.entries(zip.files)) {
    expect(name).not.toMatch(displayMarker)
    if (!entry.dir) expect(await entry.async('string')).not.toMatch(displayMarker)
  }
  expect(await zip.file('raw/all_points.csv')!.async('string')).toBe(textFile(raw.bytes))
  expect(await zip.file('README.txt')!.async('string')).toContain('Units: time = seconds')
  expect(JSON.parse(await zip.file('experiment.json')!.async('string')).seed).toBe(20260829)
  expect(zip.file('processed/processed_points.csv')).not.toBeNull()
  expect(zip.file('plot/overlay_wide.csv')).not.toBeNull()
})

test('SPR copied table retains the downloadable plot values without display markers', async ({ page }) => {
  const spr = await openSpr(page)
  await page.evaluate(() => {
    // This interception stays in the isolated test browser, never the OS clipboard.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.teachingClipboard = text },
    } })
  })
  await spr.getByRole('button', { name: /^复制作图表/ }).click()
  const copied = await page.locator('html').getAttribute('data-teaching-clipboard')
  expect(copied).not.toBeNull()
  expect(copied!).not.toMatch(displayMarker)
  const plot = await clickDownload(page, spr.getByRole('button', { name: /^下载作图 CSV/ }))
  expect(copied!.split(/\r?\n/).map((row) => row.split('\t')))
    .toEqual(textFile(plot.bytes).split(/\r?\n/).map((row) => row.split(',')))
})

test('WB built-in paired-image CSV, session JSON and both annotated PNG exports remain usable', async ({ page }) => {
  await authenticate(page)
  const wb = page.locator('.wb-stage')
  const csv = await clickDownload(page, wb.getByRole('button', { name: '导出 CSV', exact: true }))
  expect(csv.name).toBe('demo-target.png_paired-results.csv')
  expect(textFile(csv.bytes)).not.toMatch(displayMarker)
  const rows = textFile(csv.bytes).trimEnd().split(/\r?\n/).map((row) => row.split(','))
  expect(rows).toHaveLength(7)
  expect(rows[0]).toContain('Relative_expression')
  expect(rows.slice(1).map((row) => row[0])).toEqual(['1', '2', '3', '4', '5', '6'])
  rows.slice(1).forEach((row) => expect(Number(row[11])).toBeGreaterThan(0))
  const session = await clickDownload(page, wb.getByRole('button', { name: '保存会话', exact: true }))
  const settings = JSON.parse(textFile(session.bytes))
  expect(settings.lanes).toHaveLength(6)
  expect(settings.images.target).toMatchObject({ fileName: 'demo-target.png', width: 760, height: 430 })
  expect(settings.images.loading.fileName).toBe('demo-loading-control.png')
  const targetPending = page.waitForEvent('download', { predicate: (item) => item.suggestedFilename() === 'demo-target.png_annotated.png' })
  const loadingPending = page.waitForEvent('download', { predicate: (item) => item.suggestedFilename() === 'demo-loading-control.png_annotated.png' })
  await wb.getByRole('button', { name: '标注 PNG', exact: true }).click()
  for (const pending of [targetPending, loadingPending]) {
    const file = await downloadBytes(await pending)
    expect(file.bytes.subarray(1, 4).toString()).toBe('PNG')
    expect(file.bytes.readUInt32BE(16)).toBe(760)
    expect(file.bytes.readUInt32BE(20)).toBe(430)
  }
})

test('stat ordinary XLSX, CSV, JSON and PNG export while the on-page teaching warning remains', async ({ page }) => {
  await authenticate(page)
  await page.getByRole('navigation', { name: '科研工具模式', exact: true })
    .getByRole('button', { name: '数据反推生成', exact: true }).click()
  const stat = page.locator('.stat-stage')
  await expect(stat.locator('.raw-table tbody tr')).toHaveCount(8)
  const csv = await clickDownload(page, stat.getByRole('button', { name: 'CSV', exact: true }))
  const xlsx = await clickDownload(page, stat.getByRole('button', { name: '导出 XLSX', exact: true }))
  const json = await clickDownload(page, stat.getByRole('button', { name: '保存', exact: true }))
  const png = await clickDownload(page, stat.getByRole('button', { name: 'PNG', exact: true }))
  for (const file of [csv, xlsx, json, png]) expect(file.name).not.toMatch(/synthetic|simulated|模拟/i)
  expect(textFile(csv.bytes)).not.toMatch(displayMarker)
  expect(textFile(json.bytes)).not.toMatch(/synthetic|simulated|模拟/i)
  expect(png.bytes.subarray(1, 4).toString()).toBe('PNG')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsx.bytes)
  expect(workbook.worksheets[0].name).toBe('Raw_Data')
  for (const sheet of workbook.worksheets) {
    expect(JSON.stringify(sheet.getSheetValues())).not.toMatch(/synthetic|simulated|模拟/i)
  }
  const raw = workbook.getWorksheet('Raw_Data')!
  expect(raw.rowCount).toBe(9)
  expect(raw.columnCount).toBe(3)
  const csvRows = textFile(csv.bytes).trimEnd().split(/\r?\n/).map((row) => row.split(','))
  csvRows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    expect(String(raw.getCell(rowIndex + 1, columnIndex + 1).value)).toBe(value)
  }))
  const project = JSON.parse(textFile(json.bytes))
  expect(project.report.candidates).toHaveLength(3)
  project.report.candidates[0].values.forEach((values: number[], groupIndex: number) => {
    values.forEach((value, rowIndex) => expect(raw.getCell(rowIndex + 2, groupIndex + 2).value).toBe(value))
  })
  await expect(stat.locator('.warning-banner')).toContainText('SIMULATED / 合成模拟数据')
})

test('stat time-series XLSX and grouped CSV preserve matching values and subject identities', async ({ page }) => {
  await authenticate(page)
  await page.getByRole('navigation', { name: '科研工具模式', exact: true })
    .getByRole('button', { name: '数据反推生成', exact: true }).click()
  const stat = page.locator('.stat-stage')
  await stat.getByRole('button', { name: '重复测量时间序列', exact: true }).click()
  await expect(stat.getByRole('heading', { name: '时间序列结果预览', exact: true })).toBeVisible()
  const csv = await clickDownload(page, stat.getByRole('button', { name: 'CSV', exact: true }))
  const xlsx = await clickDownload(page, stat.getByRole('button', { name: '导出 XLSX', exact: true }))
  expect(csv.name).not.toMatch(displayMarker)
  expect(xlsx.name).not.toMatch(displayMarker)
  expect(textFile(csv.bytes)).not.toMatch(displayMarker)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsx.bytes)
  expect(workbook.worksheets[0].name).toBe('Grouped_Input')
  for (const sheet of workbook.worksheets) {
    expect(JSON.stringify(sheet.getSheetValues())).not.toMatch(/synthetic|simulated|模拟/i)
  }
  const grouped = workbook.getWorksheet('Grouped_Input')!
  expect(grouped.rowCount).toBe(6)
  expect(grouped.columnCount).toBe(17)
  expect(workbook.getWorksheet('Raw_Long')!.rowCount).toBe(65)
  const csvRows = textFile(csv.bytes).trimEnd().split(/\r?\n/).map((row) => row.split(','))
  csvRows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    expect(String(grouped.getCell(rowIndex + 1, columnIndex + 1).value ?? '')).toBe(value)
  }))
  expect(grouped.getCell(2, 2).value).toBe('A:1')
  expect(grouped.getCell(2, 17).value).toBe('B:8')
  expect(grouped.getCell(3, 1).value).toBe('Day 0')
  expect(grouped.getCell(6, 1).value).toBe('Day 7')
  expect(workbook.getWorksheet('Repeated_ANOVA')).toBeDefined()
  await expect(stat.locator('.warning-banner')).toContainText('SIMULATED / 合成模拟数据')
})
