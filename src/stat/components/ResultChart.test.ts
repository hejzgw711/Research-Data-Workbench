import { describe, expect, it } from 'vitest'
import { cloneSettings, defaultSettings, generateCandidates } from '../core/generator'
import { defaultTimeSeriesSettings, generateTimeSeriesCandidates, syncTimeSeriesCells } from '../core/timeSeries'
import { buildBarChart, buildTimeSeriesChart } from './ResultChart'

function grouped(count = 2, scale = 1) {
  const settings = cloneSettings(defaultSettings)
  settings.groups = Array.from({ length: count }, (_, index) => ({ ...settings.groups[0], id: 'g' + index, name: '自定义很长的实验分组名称 ' + index, n: 4, targetMean: (index + 2) * scale, targetSd: 0.1 * scale, color: ['#9acddb', '#e7ad97', '#b7d8aa', '#c4b0dd'][index % 4] }))
  settings.pairwiseConstraints = settings.groups.flatMap((left, index) => settings.groups.slice(index + 1).map(right => ({ id: left.id + '::' + right.id, leftGroupId: left.id, rightGroupId: right.id, enabled: true, pMin: 0, pMax: 1 })))
  settings.seedMode = 'locked'; settings.seed = 'adaptive-display'; settings.decimals = null; settings.maxAttempts = 1
  const report = generateCandidates(settings, 1)
  return { settings: report.settings, candidate: report.candidates[0] }
}

function longitudinal() {
  const settings = structuredClone(defaultTimeSeriesSettings)
  settings.groups = Array.from({ length: 8 }, (_, index) => ({ id: 'g' + index, name: '长名称处理分组 ' + index, n: 4, color: ['#9acddb', '#e7ad97', '#b7d8aa', '#c4b0dd'][index % 4] }))
  settings.timePoints = [0, 0.001, 0.002, 3, 40, 100].map((value, index) => ({ id: 't' + index, value, label: '自定义测量时间点 ' + value }))
  settings.yAxisTitle = '非常长的纵坐标量纲名称 (arbitrary units)'
  settings.xAxisTitle = '自定义时间轴的完整名称 Time after treatment'
  syncTimeSeriesCells(settings)
  settings.cells.forEach(cell => { cell.targetMean = 1e8 + cell.groupIndex * 10000 + cell.timeIndex * 100; cell.targetSd = 100; cell.maxValue = null })
  settings.seedMode = 'locked'; settings.seed = 'adaptive-time'; settings.decimals = null
  return { settings, candidate: generateTimeSeriesCandidates(settings, 1).candidates[0] }
}

// The option shape is inspected independently of ECharts rendering internals.
const series = (plan: ReturnType<typeof buildBarChart>) => plan.option.series as any[]
const axis = (plan: ReturnType<typeof buildBarChart>) => plan.option.yAxis as any
const api = (data: (number | string)[]) => ({ value: (index: number) => data[index], coord: ([x, y]: number[]) => [x * 100 + 50, 300 - y * 10], size: () => [100, 1] })

describe('adaptive statistical charts', () => {
  it.each([1e-9, 1e12])('keeps exact data and readable ticks at scale %s', scale => {
    const { settings, candidate } = grouped(2, scale)
    const before = JSON.stringify({ settings, candidate })
    const plan = buildBarChart(candidate, settings, 'sd', 420)
    expect(axis(plan).min).toBeLessThanOrEqual(0)
    expect(axis(plan).max).toBeGreaterThan(Math.max(...candidate.values.flat()))
    expect(axis(plan).axisLabel.formatter(axis(plan).interval)).not.toBe('0')
    expect(axis(plan).axisLabel.formatter(axis(plan).interval)).toContain('e')
    expect(series(plan).find(item => item.name === 'points').data.map((row: number[]) => row[2])).toEqual(candidate.values.flat())
    expect(JSON.stringify({ settings, candidate })).toBe(before)
  })

  it('places all eight groups and 28 comparisons with a readable data region and integer category coordinates', () => {
    const { settings, candidate } = grouped(8)
    const plan = buildBarChart(candidate, settings, 'ci', 390)
    const annotationSeries = series(plan).find(item => item.name === 'annotations')
    const annotations = annotationSeries.data as number[][]
    expect(annotations).toHaveLength(28)
    expect(plan.width).toBeGreaterThan(390)
    expect(plan.height).toBeGreaterThan(1000)
    expect((plan.option.xAxis as any).data).toEqual(settings.groups.map(group => group.name))
    expect((plan.option.xAxis as any).axisLabel.interval).toBe(0)
    const grid = plan.option.grid as any
    expect(plan.height - grid.top - grid.bottom).toBe(290)
    expect(grid.top).toBe(30 + annotations.length * 28)
    expect(annotations.every(row => row[4] === axis(plan).max)).toBe(true)
    const first = annotationSeries.renderItem({}, api(annotations[0])).children[0].shape.points[1][1]
    const second = annotationSeries.renderItem({}, api(annotations[1])).children[0].shape.points[1][1]
    expect(first - second).toBe(28)
    const withoutPairs = buildBarChart(candidate, { ...settings, pairwiseConstraints: [] }, 'ci', 390)
    expect(axis(plan).min).toBe(axis(withoutPairs).min)
    expect(axis(plan).max).toBe(axis(withoutPairs).max)
    const points = series(plan).find(item => item.name === 'points')
    expect(points.encode).toMatchObject({ x: 0, y: 2 })
    points.data.forEach((row: number[]) => {
      expect(Number.isInteger(row[0])).toBe(true)
      const rendered = points.renderItem({}, api(row))
      expect(Math.abs(rendered.shape.cx - (row[0] * 100 + 50))).toBeLessThan(16)
    })
  })

  it('uses a consistent color per two-way factor-A legend without changing means or factor mapping', () => {
    const { settings, candidate } = grouped(8)
    settings.analysisDesign = 'twoWay'
    settings.twoWay = { factorA: { name: 'A', levels: ['A1', 'A2'] }, factorB: { name: 'B', levels: ['B1', 'B2', 'B3', 'B4'] }, cells: settings.groups.map((group, index) => ({ id: group.id, factorAIndex: Math.floor(index / 4), factorBIndex: index % 4, n: group.n, targetMean: group.targetMean, targetSd: group.targetSd, minValue: 0, maxValue: null, color: group.color })) }
    const plan = buildBarChart(candidate, settings, 'sem', 600)
    const bars = series(plan).filter(item => item.name === 'A1' || item.name === 'A2')
    expect(bars).toHaveLength(2)
    expect(new Set(bars.map(bar => bar.itemStyle.color)).size).toBe(2)
    bars.forEach(bar => bar.data.forEach((row: number[]) => {
      const cell = settings.twoWay!.cells[row[3]]
      expect(row.slice(0, 3)).toEqual([cell.factorBIndex, cell.factorAIndex, candidate.summaries[row[3]].mean])
      expect(bar.renderItem({}, api(row)).style.fill).toBe(bar.itemStyle.color)
      expect(bar.itemStyle.color).toBe(settings.groups[cell.factorAIndex].color)
    }))
  })

  it.each(['sd', 'sem', 'ci'] as const)('fits negative observations and %s intervals without changing them', errorType => {
    const { settings, candidate } = grouped()
    candidate.values[0][0] = -2
    candidate.summaries[0] = { ...candidate.summaries[0], mean: 0, sd: 4, sem: 2, ciLow: -8, ciHigh: 8 }
    settings.pairwiseConstraints = []
    const plan = buildBarChart(candidate, settings, errorType, 420)
    const intervals = series(plan).find(item => item.name === 'error').data as number[][]
    expect(axis(plan).min).toBeLessThanOrEqual(Math.min(-2, ...intervals.map(row => row[2])))
    expect(axis(plan).max).toBeGreaterThanOrEqual(Math.max(...intervals.map(row => row[3])))
  })

  it('retains every irregular time label, actual spacing, custom colors and unclipped axis margins', () => {
    const { settings, candidate } = longitudinal()
    const original = JSON.stringify(candidate)
    const plan = buildTimeSeriesChart(candidate, settings, 'ci', 390)
    const lines = series(plan).filter(item => item.type === 'line')
    expect(lines).toHaveLength(8)
    lines.forEach((line, index) => {
      expect(line.data.map((row: number[]) => row[0])).toEqual(settings.timePoints.map(time => time.value))
      expect(line.lineStyle.color).toBe(settings.groups[index].color)
    })
    expect(axis(plan).min).toBeGreaterThan(0)
    const labels = series(plan).find(item => item.name === 'time labels').data as Array<Array<number | string>>
    expect(labels.map(row => String(row[2]).replaceAll('\n', ''))).toEqual(settings.timePoints.map(time => time.label))
    expect(new Set(labels.slice(0, 3).map(row => row[3])).size).toBe(3)
    expect((plan.option.legend as any).type).toBe('scroll')
    expect((plan.option.legend as any).top).toBeGreaterThan((plan.option.title as any).top)
    expect((plan.option.grid as any).left).toBeGreaterThan(axis(plan).nameGap)
    const tooltip = (plan.option.tooltip as any).formatter([
      { seriesType: 'line', seriesName: 'Group A', data: [0, 1e8] },
      { seriesType: 'custom', seriesName: 'time labels', data: [0, 0, 'junk'] },
    ])
    expect(tooltip).toContain('Group A')
    expect(tooltip).not.toContain('junk')
    expect(JSON.stringify(candidate)).toBe(original)
  })

  it('connects unsorted visits chronologically without reordering the source data', () => {
    const { settings, candidate } = longitudinal()
    const order = [0, 3, 1, 2, 5, 4]
    settings.timePoints = order.map(index => settings.timePoints[index])
    candidate.values = candidate.values.map(values => order.map(index => values[index]))
    const original = JSON.stringify({ settings, candidate })
    const plan = buildTimeSeriesChart(candidate, settings, 'sd', 600)
    const chronological = [...settings.timePoints].sort((a, b) => a.value - b.value)
    series(plan).filter(item => item.type === 'line').forEach((line, groupIndex) => {
      expect(line.data).toEqual(chronological.map(time => [time.value, candidate.summaries.find(summary => summary.groupId === settings.groups[groupIndex].id && summary.timeId === time.id)!.mean]))
    })
    expect(JSON.stringify({ settings, candidate })).toBe(original)
  })
})
