import { expect, test } from '@playwright/test'

test('two-way preview keeps factor colors, real means and concise tooltips aligned', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(() => {
    sessionStorage.setItem('research-data-workbench-authenticated', '1')
    localStorage.setItem('research-data-workbench-theme', 'light')
  })
  await page.goto('/')
  await page.getByRole('navigation', { name: '科研工具模式', exact: true }).getByRole('button', { name: '数据反推生成', exact: true }).click()
  const stat = page.locator('.stat-stage')
  await stat.getByRole('button', { name: 'Two-way ANOVA', exact: true }).click()
  await stat.getByRole('button', { name: '生成方案', exact: true }).click()
  await expect(stat.locator('.two-way-results')).toBeVisible()
  const chart = stat.locator('.stat-chart-scroll .echarts-for-react')
  const state = await chart.evaluate(element => {
    const node = element as HTMLElement & Record<string, any>
    let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))!]
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return
    const instance = fiber.stateNode.getEchartsInstance()
    const option = instance.getOption()
    const levels = option.legend[0].data as string[]
    const bars = option.series.filter((series: any) => levels.includes(series.name))
    return {
      levels, categories: option.xAxis[0].data,
      colors: bars.map((series: any) => series.itemStyle.color),
      bars: bars.map((series: any) => {
        const view = instance.getViewOfSeriesModel(instance.getModel().getSeriesByIndex(option.series.indexOf(series)))
        const fills: string[] = []
        view.group.traverse((item: any) => { if (item.type === 'rect') fills.push(item.style.fill) })
        return { count: series.data.length, fills, color: series.itemStyle.color,
          tooltip: option.tooltip[0].formatter({ data: series.data[0] }) }
      }),
      pointCount: option.series.find((series: any) => series.name === 'points').data.length,
      errorCount: option.series.find((series: any) => series.name === 'error').data.length,
    }
  })
  expect(state.levels).toHaveLength(2)
  expect(state.categories).toHaveLength(3)
  expect(new Set(state.colors).size).toBe(2)
  for (const bar of state.bars) {
    expect(bar.count).toBe(3)
    expect(bar.fills).toEqual([bar.color, bar.color, bar.color])
    expect(bar.tooltip).toMatch(/Mean: [-\d.]+/)
    expect(bar.tooltip).not.toMatch(/Category|Factor|Cell|Jitter/)
  }
  expect(state.pointCount).toBe(48)
  expect(state.errorCount).toBe(6)
  await chart.screenshot({ path: 'test-results/stat-adaptive-two-way.png' })
  expect(errors).toEqual([])
})
