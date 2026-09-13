import { expect, test, type Locator, type Page } from '@playwright/test'

async function chartState(chartElement: Locator, keepZoom = false) {
  return chartElement.evaluate((element, preserveZoom) => {
    // Inspect the mounted wrapper in this isolated browser; no application test hook is needed.
    const node = element as HTMLElement & Record<string, unknown>
    type Rectangle = { x: number; y: number; width: number; height: number; clone: () => Rectangle; applyTransform: (transform: unknown) => void }
    type Graphic = { style?: { text?: string }; getBoundingRect: () => Rectangle; getComputedTransform: () => unknown }
    type Chart = {
      getOption: () => any
      getZr: () => { storage: { getDisplayList: () => Graphic[] } }
      getModel: () => { getComponent: (name: string, index: number) => unknown }
      getViewOfComponentModel: (model: unknown) => { group: Graphic }
      dispatchAction: (action: unknown) => void
    }
    type Fiber = { stateNode?: { getEchartsInstance?: () => Chart }; return?: Fiber }
    let fiber = node[Object.keys(node).find((key) => key.startsWith('__reactFiber$'))!] as Fiber | undefined
    while (fiber && typeof fiber.stateNode?.getEchartsInstance !== 'function') fiber = fiber.return
    const chart = fiber?.stateNode?.getEchartsInstance?.()
    if (!chart) throw new Error('SPR chart has not mounted')
    const option = chart.getOption()
    const graphicBounds = (graphic: Graphic) => {
      const rectangle = graphic.getBoundingRect().clone()
      rectangle.applyTransform(graphic.getComputedTransform())
      return { top: rectangle.y, bottom: rectangle.y + rectangle.height }
    }
    const title = chart.getZr().storage.getDisplayList().find((item) => item.style?.text === 'Injection-aligned time (s)')
    if (!title) throw new Error('X axis title was not drawn')
    const slider = chart.getViewOfComponentModel(chart.getModel().getComponent('dataZoom', 1)).group
    const yAxis = option.yAxis[0]
    const series = option.series.filter(Boolean)
    const values = series.flatMap((item: { data: number[][] }) => item.data.map((point) => point[1]))
    const positive = values.find((value: number) => value > 0) ?? 0
    const zoomBefore = [option.dataZoom[0].start, option.dataZoom[0].end]
    chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 15, end: 65 })
    const zoom = chart.getOption().dataZoom[0]
    const zoomRange = [zoom.start, zoom.end]
    if (!preserveZoom) chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 })
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      title: graphicBounds(title), slider: graphicBounds(slider),
      allVisible: values.every((value: number) => yAxis.min <= value && value <= yAxis.max),
      series: series.length, points: values.length,
      interval: yAxis.interval, maximum: yAxis.max,
      nonzeroTick: yAxis.axisLabel.formatter(yAxis.interval),
      tooltip: option.tooltip[0].valueFormatter(positive),
      xMinimum: option.xAxis[0].min,
      zoomBefore, zoomRange,
    }
  }, keepZoom)
}

async function openSpr(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('research-data-workbench-authenticated', '1'))
  await page.goto('/')
  await page.getByRole('navigation', { name: '科研工具模式', exact: true })
    .getByRole('button', { name: 'SPR 数据生成', exact: true }).click()
  return page.locator('.spr-mode')
}

for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
  test(`SPR chart fits ${viewport.width}px with independent title/zoom spacing and nonzero tiny labels`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.setViewportSize(viewport)
    const spr = await openSpr(page)
    const chart = spr.locator('.echarts-for-react')
    await chart.scrollIntoViewIfNeeded()
    const initial = await chartState(chart)
    expect(initial.pageWidth).toBe(initial.viewportWidth)
    expect(initial.title.bottom).toBeLessThan(initial.slider.top - 8)
    expect(initial.xMinimum).toBeLessThan(0)
    expect(initial.allVisible).toBe(true)
    expect(initial.series).toBe(14)
    expect(initial.points).toBe(14 * 432)
    expect(initial.zoomRange).toEqual([15, 65])

    await spr.locator('.field:has(> span:text-is("Rmax")) input').fill('0.0000001')
    await spr.getByRole('button', { name: '生成数据', exact: true }).click()
    await spr.locator('.chart-controls label').filter({ hasText: 'Curve' }).locator('select').selectOption('modelTruthRU')
    const tiny = await chartState(chart, true)
    expect(tiny.maximum).toBeLessThan(1e-5)
    expect(tiny.interval).toBeGreaterThan(0)
    expect(tiny.nonzeroTick).not.toMatch(/^0(?:\.0+)?$/)
    expect(tiny.tooltip).toMatch(/[1-9]/)
    expect(tiny.tooltip).toContain('RU')
    expect(tiny.allVisible).toBe(true)
    expect(tiny.title.bottom).toBeLessThan(tiny.slider.top - 8)

    await spr.getByRole('button', { name: '单循环', exact: true }).click()
    const single = await chartState(chart)
    expect(single.series).toBe(1)
    expect(single.points).toBe(432)
    expect(single.allVisible).toBe(true)
    expect(single.zoomBefore).toEqual([15, 65])
    expect(single.zoomRange).toEqual([15, 65])
    expect(errors).toEqual([])
  })
}
