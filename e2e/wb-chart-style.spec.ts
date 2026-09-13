import { expect, test, type Locator, type Page } from '@playwright/test'

async function openWb(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('research-data-workbench-authenticated', '1')
    localStorage.setItem('research-data-workbench-theme', 'light')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      // Isolated browser-only interception: never writes to the OS clipboard.
      writeText: async (text: string) => { document.documentElement.dataset.wbChartClipboard = text },
    } })
  })
  await page.goto('/')
  const wb = page.locator('.wb-stage')
  await expect(wb.getByRole('heading', { name: '结果柱状图预览', exact: true })).toBeVisible()
  await expect(wb.locator('.group-preview .result-table tbody tr')).toHaveCount(2)
  return wb
}

async function tableCells(table: Locator) {
  return table.locator('tr').evaluateAll((rows) => rows.map((row) =>
    Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent?.trim() ?? '')))
}

async function chartAppearance(wb: Locator) {
  return wb.locator('.group-svg').evaluate((svg) => {
    const paint = (selector: string, property: 'fill' | 'stroke') =>
      Array.from(svg.querySelectorAll(selector), (node) => getComputedStyle(node)[property])
    return {
      background: getComputedStyle(svg).backgroundColor,
      bars: paint('.wb-bar', 'fill'),
      points: paint('.wb-point', 'fill'),
      lines: paint('line', 'stroke'),
      text: paint('text', 'fill'),
    }
  })
}

test('WB preview uses distinct pastel groups and a theme-independent white scientific canvas', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const wb = await openWb(page)
  const svg = wb.locator('.group-svg')
  await expect(wb.locator('.group-chart-title')).toHaveText('相对表达量（对照组均值 = 1）')
  await expect(wb.locator('.group-chart-footer')).toContainText('SD')
  await expect(svg.locator('circle')).toHaveCount(6)
  await expect(svg).not.toContainText(/p\s*[=<]/i)
  const light = await chartAppearance(wb)
  expect(light.background).toBe('rgb(255, 255, 255)')
  expect(light.bars).toHaveLength(2)
  expect(new Set(light.bars).size).toBe(2)
  expect(light.bars).toEqual(['rgb(154, 205, 219)', 'rgb(231, 173, 151)'])
  expect(light.points.every((fill) => fill !== 'rgb(255, 255, 255)')).toBe(true)
  expect(light.text.every((fill) => fill !== 'rgb(255, 255, 255)')).toBe(true)
  await wb.locator('.group-preview').screenshot({ path: 'test-results/wb-chart-preview-light.png' })

  await wb.getByRole('button', { name: '切换到深色主题', exact: true }).click()
  await expect(page.locator('.combined-shell')).toHaveAttribute('data-theme', 'dark')
  expect(await chartAppearance(wb)).toEqual(light)
  await wb.locator('.group-preview').screenshot({ path: 'test-results/wb-chart-preview-dark.png' })
  await wb.getByRole('button', { name: '切换到浅色主题', exact: true }).click()
  expect(await chartAppearance(wb)).toEqual(light)
  expect(errors).toEqual([])
})

test('WB copied summary matches the table and retains the original lane-based mean, SD and SEM', async ({ page }) => {
  const wb = await openWb(page)
  const rows = await tableCells(wb.locator('.group-preview .result-table'))
  expect(rows[0]).toEqual(['组别', 'n', '均值', 'SD', 'SEM'])
  await wb.getByRole('button', { name: '复制汇总', exact: true }).click()
  const text = await page.locator('html').getAttribute('data-wb-chart-clipboard')
  expect(text?.split(/\r?\n/).map((row) => row.split('\t'))).toEqual(rows)

  const normalized = wb.locator('.results-panel .result-block')
    .filter({ hasText: '相对表达量（对照组均值 = 1）' })
  const laneRows = await tableCells(normalized.locator('.result-table'))
  const groups = laneRows[0].slice(1)
  const values = laneRows[1].slice(1).map(Number)
  for (const [name, n, mean, sd, sem] of rows.slice(1)) {
    const groupValues = values.filter((_, index) => groups[index] === name)
    expect(groupValues).toHaveLength(Number(n))
    const expectedMean = groupValues.reduce((sum, value) => sum + value, 0) / groupValues.length
    const expectedSd = Math.sqrt(groupValues.reduce((sum, value) => sum + (value - expectedMean) ** 2, 0) / (groupValues.length - 1))
    // Source lane display is rounded to four decimals; summary display to three.
    expect(Math.abs(Number(mean) - expectedMean)).toBeLessThan(0.001)
    expect(Math.abs(Number(sd) - expectedSd)).toBeLessThan(0.001)
    expect(Math.abs(Number(sem) - expectedSd / Math.sqrt(groupValues.length))).toBeLessThan(0.001)
  }
})

test('WB data survive tool and theme switches and remain usable at 390px', async ({ page }) => {
  const wb = await openWb(page)
  await wb.getByRole('textbox', { name: 'Lane 1 样本', exact: true }).fill('课堂样本 A')
  const originalSummary = await tableCells(wb.locator('.group-preview .result-table'))
  const originalChart = await chartAppearance(wb)
  await wb.getByRole('navigation', { name: '科研工具模式', exact: true })
    .getByRole('button', { name: '数据反推生成', exact: true }).click()
  await page.locator('.stat-stage').getByRole('button', { name: '切换到深色主题', exact: true }).click()
  await page.locator('.stat-stage').getByRole('navigation', { name: '科研工具模式', exact: true })
    .getByRole('button', { name: 'WB 灰度测量', exact: true }).click()
  await expect(wb.getByRole('textbox', { name: 'Lane 1 样本', exact: true })).toHaveValue('课堂样本 A')
  expect(await tableCells(wb.locator('.group-preview .result-table'))).toEqual(originalSummary)
  expect(await chartAppearance(wb)).toEqual(originalChart)
  await expect(wb.locator('.group-svg circle')).toHaveCount(6)
  await page.setViewportSize({ width: 390, height: 844 })
  await wb.locator('.group-svg').scrollIntoViewIfNeeded()
  await expect(wb.locator('.group-svg')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await tableCells(wb.locator('.group-preview .result-table'))).toEqual(originalSummary)
  await wb.locator('.group-preview').screenshot({ path: 'test-results/wb-chart-preview-mobile.png' })
})

test('WB axes use readable ticks and wrap complete long group labels in a local scroll area', async ({ page }) => {
  const wb = await openWb(page)
  const names = ['Control', '联合治疗术后第十二天第一组', 'Long treatment group number two', 'Long treatment group number three', 'Long treatment group number four', 'Long treatment group number five']
  for (let index = 0; index < names.length; index++) await wb.getByRole('textbox', { name: 'Lane ' + (index + 1) + ' 组别', exact: true }).fill(names[index])
  await expect(wb.locator('.wb-bar')).toHaveCount(6)
  const labels = await wb.locator('.wb-x-label').evaluateAll(nodes => nodes.map(node => Array.from(node.querySelectorAll('tspan'), span => span.textContent).join('')))
  expect(labels).toEqual(names)
  const ticks = await wb.locator('.wb-y-tick').allTextContents()
  expect(new Set(ticks).size).toBe(ticks.length)
  expect(ticks).toContain('0')
  expect(ticks.every(label => label.length < 10)).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await wb.locator('.group-chart-scroll').scrollIntoViewIfNeeded()
  await expect.poll(() => wb.locator('.group-chart-scroll').evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await wb.locator('.wb-x-label').first().evaluate(element => getComputedStyle(element).fontSize)).toBe('12px')
  const geometry = await wb.locator('.group-svg').evaluate(svg => {
    const bounds = (svg as unknown as SVGSVGElement).viewBox.baseVal
    return Array.from(svg.querySelectorAll('.wb-point, .wb-x-label'), element => {
      const box = (element as SVGGraphicsElement).getBBox()
      return box.x >= 0 && box.y >= 0 && box.x + box.width <= bounds.width && box.y + box.height <= bounds.height
    })
  })
  expect(geometry.every(Boolean)).toBe(true)
  await wb.locator('.group-preview').screenshot({ path: 'test-results/wb-chart-long-groups.png' })
})

test('WB chart resizes after restoring an empty preview', async ({ page }) => {
  const wb = await openWb(page)
  page.once('dialog', dialog => dialog.accept())
  await wb.getByRole('button', { name: '一键清空', exact: true }).click()
  await expect(wb.locator('.group-svg')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await wb.getByRole('button', { name: '示例双图', exact: true }).click()
  await expect(wb.locator('.wb-point')).toHaveCount(6)
  await expect.poll(() => wb.locator('.group-svg').evaluate(svg => svg.getBoundingClientRect().width)).toBeLessThan(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
