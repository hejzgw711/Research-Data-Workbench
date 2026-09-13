import { expect, test, type Locator, type Page } from '@playwright/test'

async function openTimeSeries(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(theme => {
    sessionStorage.setItem('research-data-workbench-authenticated', '1')
    localStorage.setItem('research-data-workbench-theme', theme)
  }, theme)
  await page.goto('/')
  await page.getByRole('navigation', { name: '科研工具模式', exact: true })
    .getByRole('button', { name: '数据反推生成', exact: true }).click()
  const stat = page.locator('.stat-stage')
  await stat.getByRole('button', { name: '重复测量时间序列', exact: true }).click()
  await expect(stat.getByRole('heading', { name: '时间序列结果预览', exact: true })).toBeVisible()
  await expect(page.locator('.combined-shell')).toHaveAttribute('data-theme', theme)
  return stat
}

async function expectNamesInsideHeaders(matrix: Locator) {
  const bounds = await matrix.locator('tbody tr').evaluateAll(rows => rows.map(row => {
    const heading = row.querySelector<HTMLElement>('.ts-group-heading')!
    const name = heading.querySelector<HTMLElement>('.ts-group-name')!
    const mark = heading.querySelector<HTMLElement>('.group-mark')!
    const rect = heading.getBoundingClientRect()
    const nameRect = name.getBoundingClientRect()
    const markRect = mark.getBoundingClientRect()
    return {
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width,
      nameLeft: nameRect.left, nameRight: nameRect.right, nameTop: nameRect.top, nameBottom: nameRect.bottom,
      markLeft: markRect.left, markRight: markRect.right,
      inputLeft: row.querySelector('td input')!.getBoundingClientRect().left,
      writingMode: getComputedStyle(name).writingMode,
      scope: heading.getAttribute('scope'), background: getComputedStyle(heading).backgroundColor,
    }
  }))
  for (const item of bounds) {
    expect(item.scope).toBe('row')
    expect(item.writingMode).toBe('sideways-lr')
    expect(item.width).toBeGreaterThanOrEqual(79)
    expect(item.width).toBeLessThanOrEqual(81)
    expect(item.nameLeft).toBeGreaterThanOrEqual(item.left)
    expect(item.nameRight).toBeLessThanOrEqual(item.right)
    expect(item.nameTop).toBeGreaterThanOrEqual(item.top)
    expect(item.nameBottom).toBeLessThanOrEqual(item.bottom)
    expect(item.markLeft).toBeGreaterThanOrEqual(item.left)
    expect(item.markRight).toBeLessThanOrEqual(item.right)
    expect(item.inputLeft).toBeGreaterThanOrEqual(item.right)
    expect(item.background).not.toBe('rgba(0, 0, 0, 0)')
  }
}

for (const width of [390, 1600]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`time-series row labels stay contained and editable at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const stat = await openTimeSeries(page, theme)
      const matrix = stat.locator('.ts-cell-grid-wrap')
      const headings = matrix.locator('.ts-group-heading')
      await expect(headings).toHaveCount(2)
      await expect(headings.nth(0)).toHaveAttribute('title', 'Control')
      await expect(headings.nth(1)).toHaveAttribute('title', 'Treatment')
      await expectNamesInsideHeaders(matrix)
      await matrix.screenshot({ path: testInfo.outputPath('default-labels.png') })

      const raw = stat.locator('.ts-raw-table tbody')
      const originalResult = await raw.textContent()
      const names = [
        'Treatment Group With A Deliberately Long English Name '.repeat(4),
        '连续多天观察的超长中文实验处理分组名称用于检查完整显示与输入框边界'.repeat(4),
      ]
      for (const [index, name] of names.entries()) {
        await stat.locator('.ts-group-row > input').nth(index).fill(name)
        await expect(headings.nth(index)).toHaveAttribute('title', name)
        await expect(headings.nth(index).locator('.ts-group-name')).toHaveText(name)
        await expect(headings.nth(index).locator('.ts-group-name')).toHaveCSS('text-overflow', 'ellipsis')
        expect(await headings.nth(index).locator('.ts-group-name').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(180)
      }
      await expectNamesInsideHeaders(matrix)
      expect(await raw.textContent()).toBe(originalResult)

      for (let index = 0; index < 8; index++) {
        await stat.getByRole('button', { name: '添加时间点', exact: true }).click()
      }
      await expect(matrix.locator('thead th')).toHaveCount(13)
      expect(await matrix.locator('table').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(80 + 12 * 160)
      expect(await matrix.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(await raw.textContent()).toBe(originalResult)
      await expectNamesInsideHeaders(matrix)

      await headings.first().scrollIntoViewIfNeeded()
      const initialX = (await headings.first().boundingBox())!.x
      await matrix.evaluate(element => { element.scrollLeft = 240 })
      await expect.poll(() => matrix.evaluate(element => element.scrollLeft)).toBe(240)
      expect(Math.abs((await headings.first().boundingBox())!.x - initialX)).toBeLessThanOrEqual(1)
      expect(await headings.first().evaluate(element => {
        const rect = element.getBoundingClientRect()
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('.ts-group-heading') === element
      })).toBe(true)
      await matrix.screenshot({ path: testInfo.outputPath('long-labels-scrolled.png') })

      await matrix.evaluate(element => { element.scrollLeft = 0 })
      const firstCell = matrix.locator('tbody tr').first().locator('td').first()
      const otherCell = matrix.locator('tbody tr').nth(1).locator('td').first()
      const otherMean = await otherCell.getByLabel('均值', { exact: true }).inputValue()
      const otherSd = await otherCell.getByLabel('SD', { exact: true }).inputValue()
      await firstCell.getByLabel('均值', { exact: true }).fill('52')
      await firstCell.getByLabel('SD', { exact: true }).fill('4')
      await firstCell.getByLabel('SD', { exact: true }).press('Tab')
      await expect(firstCell.getByLabel('均值', { exact: true })).toHaveValue('52')
      await expect(firstCell.getByLabel('SD', { exact: true })).toHaveValue('4')
      await expect(otherCell.getByLabel('均值', { exact: true })).toHaveValue(otherMean)
      await expect(otherCell.getByLabel('SD', { exact: true })).toHaveValue(otherSd)
      expect(await raw.textContent()).toBe(originalResult)

      await stat.getByRole('button', { name: '生成方案', exact: true }).click()
      await expect(stat.locator('.ts-result-meta')).toHaveText('2 组 × 12 时间点')
      await expect(raw.locator('tr')).toHaveCount(12)
      await expect(raw.locator('tr').first().locator('td')).toHaveCount(16)
      const values = await raw.locator('td').allTextContents()
      expect(values.every(value => value.trim() !== '' && Number.isFinite(Number(value)))).toBe(true)
      await expect(stat.locator('.ts-raw-table thead tr').first().locator('th').nth(1)).toHaveText(names[0])
      await expect(stat.locator('.ts-raw-table thead tr').first().locator('th').nth(2)).toHaveText(names[1])
      const generatedResult = await raw.textContent()
      const opposite = theme === 'light' ? '深色' : '浅色'
      await stat.getByRole('button', { name: `切换到${opposite}主题`, exact: true }).click()
      await page.setViewportSize({ width: width === 390 ? 1600 : 390, height: 1000 })
      expect(await raw.textContent()).toBe(generatedResult)
      await expect(firstCell.getByLabel('均值', { exact: true })).toHaveValue('52')
      await expect(firstCell.getByLabel('SD', { exact: true })).toHaveValue('4')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(errors).toEqual([])
    })
  }
}
