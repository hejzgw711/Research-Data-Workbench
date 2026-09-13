import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { GeneratorSettings, TimeSeriesGeneratorSettings } from '../src/stat/models'

async function openStat(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('research-data-workbench-authenticated', '1')
    localStorage.setItem('research-data-workbench-theme', 'light')
  })
  await page.goto('/')
  await page.getByRole('button', { name: '数据反推生成', exact: true }).click()
  const stat = page.locator('.stat-stage')
  await expect(stat.locator('.stat-chart-scroll canvas')).toBeVisible()
  return stat
}

test('eight tiny-value groups retain all observations and 28 brackets in a scrollable exportable chart', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const stat = await openStat(page)
  const report = await page.evaluate(async () => {
  const moduleUrl = '/src/stat/core/generator.ts'
  const { cloneSettings, defaultSettings, generateCandidates } = await import(moduleUrl)
  const settings: GeneratorSettings = cloneSettings(defaultSettings)
  settings.groups = Array.from({ length: 8 }, (_, index) => ({ ...settings.groups[0], id: 'g' + index, name: '长名称实验处理分组 ' + (index + 1), n: 4, targetMean: (index + 2) * 1e-8, targetSd: 1e-9, color: ['#9acddb', '#e7ad97', '#b7d8aa', '#c4b0dd'][index % 4] }))
  settings.pairwiseConstraints = settings.groups.flatMap((left, index) => settings.groups.slice(index + 1).map(right => ({ id: left.id + '::' + right.id, leftGroupId: left.id, rightGroupId: right.id, enabled: true, pMin: 0, pMax: 1 })))
  settings.seedMode = 'locked'; settings.seed = 'e2e-adaptive-groups'; settings.decimals = null; settings.maxAttempts = 1
  return generateCandidates(settings, 1)
  })
  await stat.locator('input[type=file]').setInputFiles({ name: 'adaptive-chart.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, settings: report.settings, report })) })
  await expect(stat.locator('.toast')).toHaveText('项目已打开')
  const chart = stat.locator('.stat-chart-scroll')
  expect(await chart.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  expect(await chart.locator('.echarts-for-react').evaluate(element => element.clientHeight)).toBeGreaterThan(1000)
  const table = stat.locator('.raw-card .raw-table table')
  await expect(table.locator('thead th')).toHaveCount(9)
  const displayed = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll('td')).slice(1).map(cell => Number(cell.textContent))))
  expect(displayed).toEqual(Array.from({ length: 4 }, (_, index) => report.candidates[0].values.map(values => values[index])))
  const pending = page.waitForEvent('download')
  await stat.getByRole('button', { name: 'PNG', exact: true }).click()
  const download = await pending
  expect(await download.failure()).toBeNull()
  await download.saveAs('test-results/stat-adaptive-eight-groups.png')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await chart.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('eight longitudinal groups render all irregular visits with separate title and scrollable legend', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const stat = await openStat(page)
  const report = await page.evaluate(async () => {
  const moduleUrl = '/src/stat/core/timeSeries.ts'
  const { defaultTimeSeriesSettings, generateTimeSeriesCandidates, syncTimeSeriesCells } = await import(moduleUrl)
  const settings: TimeSeriesGeneratorSettings = structuredClone(defaultTimeSeriesSettings)
  settings.groups = Array.from({ length: 8 }, (_, index) => ({ id: 'g' + index, name: '行为学连续观察处理分组 ' + (index + 1), n: 4, color: ['#9acddb', '#e7ad97', '#b7d8aa', '#c4b0dd'][index % 4] }))
  settings.timePoints = [0, 0.001, 0.002, 3, 40, 100].map((value, index) => ({ id: 't' + index, value, label: '测量时间点 ' + value }))
  settings.chartTitle = '八组连续重复测量：不规则时间间隔完整展示'
  settings.yAxisTitle = '运动距离的累计变化 (arbitrary units)'
  settings.xAxisTitle = '干预后自定义随访时间 Time after treatment'
  syncTimeSeriesCells(settings)
  settings.cells.forEach(cell => { cell.targetMean = 1e8 + cell.groupIndex * 10000 + cell.timeIndex * 100; cell.targetSd = 100; cell.maxValue = null })
  settings.seedMode = 'locked'; settings.seed = 'e2e-adaptive-time'; settings.decimals = null
  return generateTimeSeriesCandidates(settings, 1)
  })
  await stat.locator('input[type=file]').setInputFiles({ name: 'adaptive-time.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, design: 'repeated-measures-time-series', settings: report.settings, report })) })
  await expect(stat.locator('.toast')).toHaveText('项目已打开')
  await expect(stat.getByRole('heading', { name: '时间序列结果预览', exact: true })).toBeVisible()
  await expect(stat.locator('.ts-result-meta')).toHaveText('8 组 × 6 时间点')
  const image = await stat.locator('.stat-chart-scroll canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL('image/png'))
  await writeFile('test-results/stat-adaptive-irregular-time.png', Buffer.from(image.split(',')[1], 'base64'))
  const tableBefore = await stat.locator('.raw-card .raw-table').textContent()
  await stat.getByRole('button', { name: '切换到深色主题', exact: true }).click()
  await expect(stat.locator('.stat-chart-scroll')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  expect(await stat.locator('.raw-card .raw-table').textContent()).toBe(tableBefore)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
