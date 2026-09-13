import { expect, test } from '@playwright/test'

const modes = [
  ['WB 灰度测量', 'wb'],
  ['数据反推生成', 'stat'],
  ['qPCR 数据模拟', 'qpcr'],
  ['SPR 数据生成', 'spr'],
] as const

for (const width of [390, 1600, 2560]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`four workbench pages fill ${width}px with aligned gutters and ${theme} outer edges`, async ({ page }, testInfo) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.setViewportSize({ width, height: 1000 })
      await page.addInitScript((selectedTheme) => {
        sessionStorage.setItem('research-data-workbench-authenticated', '1')
        localStorage.setItem('research-data-workbench-theme', selectedTheme)
      }, theme)
      await page.goto('/')
      const gutter = width <= 760 ? 16 : 26
      const expectedBackground = theme === 'light' ? 'rgb(237, 243, 241)' : 'rgb(7, 24, 23)'
      for (const [name, stage] of modes) {
        await page.getByRole('navigation', { name: '科研工具模式', exact: true })
          .getByRole('button', { name, exact: true }).click()
        const current = page.locator(`.${stage}-stage`)
        const header = current.locator('.workbench-header')
        await expect(header).toBeVisible()
        await page.evaluate(() => scrollTo(0, 0))
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
        const headerBox = (await header.boundingBox())!
        expect(headerBox.x).toBe(gutter)
        expect(headerBox.width).toBe(width - gutter * 2)
        const navigationLeft = await current.locator('.combined-switcher').evaluate(element => {
          return element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft)
        })
        expect(navigationLeft).toBe(gutter)
        const edgeColors = await page.evaluate(() => {
          const backgroundAt = (x: number) => {
            let element = document.elementFromPoint(x, 8)
            while (element) {
              const color = getComputedStyle(element).backgroundColor
              if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
              element = element.parentElement
            }
            return ''
          }
          return [backgroundAt(1), backgroundAt(document.documentElement.clientWidth - 2)]
        })
        expect(edgeColors).toEqual([expectedBackground, expectedBackground])

        if (stage === 'qpcr') {
          const child = page.frameLocator('iframe[title="qPCR 数据模拟工具"]')
          await expect(child.getByTestId('well-count')).toHaveText('72 孔')
          await expect(child.locator('html')).toHaveAttribute('data-theme', theme)
          await expect.poll(() => child.locator('html').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
          const frame = (await page.locator('iframe[title="qPCR 数据模拟工具"]').boundingBox())!
          const shell = (await child.locator('.app-shell').boundingBox())!
          const content = (await child.locator('.generation-card').boundingBox())!
          expect(frame.x).toBe(0)
          expect(frame.width).toBe(width)
          expect(shell.width).toBe(width)
          expect(content.x).toBe(gutter)
          expect(content.width).toBe(width - gutter * 2)
        } else if (stage === 'spr') {
          const workspace = (await current.locator('.workspace').boundingBox())!
          const parameters = (await current.locator('.parameter-column').boundingBox())!
          const results = (await current.locator('.result-column').boundingBox())!
          expect(workspace.x).toBe(0)
          expect(workspace.width).toBe(width)
          expect(parameters.x).toBe(gutter)
          expect(results.x + results.width).toBeCloseTo(width - gutter, 0)
        } else {
          const workspace = (await current.locator('.workspace').boundingBox())!
          expect(workspace.x).toBe(gutter)
          expect(workspace.width).toBe(width - gutter * 2)
        }
        if (width === 2560 || (width === 390 && stage === 'qpcr')) {
          await page.screenshot({ path: testInfo.outputPath(`${stage}-${theme}-${width}.png`), animations: 'disabled' })
        }
      }
      expect(errors).toEqual([])
    })
  }
}
