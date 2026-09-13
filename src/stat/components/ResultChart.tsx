import ReactECharts from 'echarts-for-react'
import { forwardRef } from 'react'
import type { CustomSeriesRenderItemAPI, EChartsOption } from 'echarts'
import { chartNumericAxis, formatChartTick, wrapChartLabel } from '../../chartDisplay'
import { useChartWidth } from '../../useChartWidth'
import type { Candidate, GeneratorSettings, Summary, TimeSeriesCandidate, TimeSeriesGeneratorSettings } from '../models'

type ErrorType = 'sd' | 'sem' | 'ci'
type RenderApi = CustomSeriesRenderItemAPI
type ChartPlan = { option: EChartsOption; width: number; height: number }
const ink = '#263936'
const lineStyle = { color: '#657d79', width: 1.2 }
const gridLine = { color: '#dfe7e5' }

function pLabel(pValue: number) {
  const p = pValue < 0.0001 ? pValue.toExponential(2) : pValue.toFixed(4)
  const stars = pValue < 0.0001 ? '****' : pValue < 0.001 ? '***' : pValue < 0.01 ? '**' : pValue < 0.05 ? '*' : 'ns'
  return 'p=' + p + ' ' + stars
}

function errorFor(summary: Pick<Summary, 'mean' | 'sd' | 'sem' | 'ciLow' | 'ciHigh'>, type: ErrorType) {
  return type === 'sem' ? [summary.mean - summary.sem, summary.mean + summary.sem]
    : type === 'ci' ? [summary.ciLow, summary.ciHigh] : [summary.mean - summary.sd, summary.mean + summary.sd]
}

function errorShape(x: number, low: number, high: number, cap = 6) {
  return { type: 'group' as const, children: [
    { type: 'line' as const, shape: { x1: x, y1: low, x2: x, y2: high }, style: { stroke: ink, lineWidth: 1.5 } },
    { type: 'line' as const, shape: { x1: x - cap, y1: low, x2: x + cap, y2: low }, style: { stroke: ink, lineWidth: 1.5 } },
    { type: 'line' as const, shape: { x1: x - cap, y1: high, x2: x + cap, y2: high }, style: { stroke: ink, lineWidth: 1.5 } },
  ] }
}

function yAxisLayout(axis: ReturnType<typeof chartNumericAxis>, name: string) {
  const tickWidth = Math.max(...axis.ticks.map(value => formatChartTick(value, axis.interval).length), 1) * 7
  return { left: tickWidth + 32 + name.split('\n').length * 16, nameGap: tickWidth + 22 }
}

function numericYAxis(axis: ReturnType<typeof chartNumericAxis>, name: string) {
  return { type: 'value' as const, min: axis.min, max: axis.max, interval: axis.interval,
    name, nameLocation: 'middle' as const, nameGap: yAxisLayout(axis, name).nameGap, nameRotate: 90,
    nameTextStyle: { color: ink, fontSize: 12, lineHeight: 16 },
    axisLabel: { color: ink, formatter: (value: number) => formatChartTick(value, axis.interval) },
    axisLine: { show: true, onZero: false, lineStyle }, axisTick: { show: true, lineStyle }, splitLine: { lineStyle: gridLine } }
}

export function buildBarChart(candidate: Candidate, settings: GeneratorSettings, errorType: ErrorType, availableWidth: number): ChartPlan {
  const twoWay = settings.analysisDesign === 'twoWay' ? settings.twoWay : undefined
  const factorCount = twoWay?.factorA.levels.length ?? 1
  const categories = twoWay?.factorB.levels ?? settings.groups.map(group => group.name)
  const cells = (twoWay ? twoWay.cells.map(cell => ({ id: cell.id, b: cell.factorBIndex, a: cell.factorAIndex, color: cell.color }))
    : settings.groups.map((group, b) => ({ id: group.id, b, a: 0, color: group.color })))
    .map((cell, index) => ({ ...cell, summary: candidate.summaries.find(summary => summary.groupId === cell.id)!, values: candidate.values[index] ?? [] }))
  const factorColors = Array.from({ length: factorCount }, (_, a) => settings.groups[a]?.color ?? cells.find(cell => cell.a === a)?.color ?? '#9acddb')
  const errors = cells.map(cell => errorFor(cell.summary, errorType))
  const dataValues = cells.flatMap((cell, index) => [...cell.values, cell.summary.mean, ...errors[index]])
  const annotations = settings.pairwiseConstraints.filter(constraint => constraint.enabled !== false).flatMap(constraint => {
    const left = cells.find(cell => cell.id === constraint.leftGroupId)
    const right = cells.find(cell => cell.id === constraint.rightGroupId)
    const pair = candidate.test.method === 'anova'
      ? candidate.test.pairwise?.find(item => item.leftGroupId === constraint.leftGroupId && item.rightGroupId === constraint.rightGroupId)
      : left?.b === 0 && right?.b === 1 ? { adjustedPValue: candidate.test.pValue } : undefined
    return left && right && pair ? [{ left, right, label: pLabel(pair.adjustedPValue) }] : []
  })
  const axis = chartNumericAxis(dataValues, { includeZero: true, padding: 0.08 })
  const leftMargin = yAxisLayout(axis, 'Synthetic value').left
  const width = Math.ceil(Math.max(availableWidth, 300, categories.length * Math.max(100, factorCount * 62) + leftMargin + 28))
  const labelChars = Math.max(8, Math.min(16, Math.floor((width - leftMargin - 28) / Math.max(1, categories.length) / 8)))
  const labels = categories.map(label => wrapChartLabel(label, labelChars))
  const bottom = 30 + Math.max(1, ...labels.map(label => label.split('\n').length)) * 16
  const legendLines = twoWay ? Math.max(1, ...twoWay.factorA.levels.map(label => wrapChartLabel(label, 18).split('\n').length)) : 0
  const baseTop = twoWay ? 48 + legendLines * 16 : 30
  const bracketStep = 28
  // Brackets occupy screen space above the plot without inflating the data axis.
  const top = baseTop + annotations.length * bracketStep
  const plotHeight = 290
  const height = top + plotHeight + bottom
  const barWidth = (api: RenderApi) => {
    const size = api.size!([1, 0])
    return Math.abs(Array.isArray(size) ? size[0] : size) * 0.72 / factorCount
  }
  const center = (api: RenderApi, b: number, a: number, value: number) => {
    const point = api.coord([b, value])
    return [point[0] + (a - (factorCount - 1) / 2) * barWidth(api), point[1]]
  }
  const bars = Array.from({ length: factorCount }, (_, a) => ({ name: twoWay?.factorA.levels[a] ?? 'Mean', type: 'custom' as const,
    dimensions: ['Category', 'Factor', 'Mean', 'Cell'], encode: { x: 0, y: 2, tooltip: [2] },
    itemStyle: { color: factorColors[a] },
    data: cells.flatMap((cell, index) => cell.a === a ? [[cell.b, cell.a, cell.summary.mean, index]] : []),
    renderItem: (_params: unknown, api: RenderApi) => {
      const point = center(api, Number(api.value(0)), Number(api.value(1)), Number(api.value(2)))
      const y0 = api.coord([Number(api.value(0)), 0])[1]
      const width = barWidth(api) * 0.76
      return { type: 'rect' as const, shape: { x: point[0] - width / 2, y: Math.min(point[1], y0), width, height: Math.abs(y0 - point[1]) },
        style: { fill: twoWay ? factorColors[a] : cells[Number(api.value(3))].color, stroke: '#354a46', lineWidth: 1.2 } }
    }, z: 2 }))
  const points = { name: 'points', type: 'custom' as const, silent: true, tooltip: { show: false },
    dimensions: ['Category', 'Factor', 'Value', 'Jitter'], encode: { x: 0, y: 2, tooltip: [] },
    data: cells.flatMap(cell => cell.values.map((value, replicate) => [cell.b, cell.a, value, cell.values.length > 1 ? (replicate / (cell.values.length - 1) - 0.5) * 0.4 : 0])),
    renderItem: (_params: unknown, api: RenderApi) => {
      // Only the screen position jitters; the category coordinate is an integer.
      const point = center(api, Number(api.value(0)), Number(api.value(1)), Number(api.value(2)))
      return { type: 'circle' as const, shape: { cx: point[0] + Number(api.value(3)) * barWidth(api), cy: point[1], r: 4 }, style: { fill: ink, opacity: 0.88 } }
    }, z: 5 }
  const errorSeries = { name: 'error', type: 'custom' as const, silent: true, tooltip: { show: false },
    dimensions: ['Category', 'Factor', 'Low', 'High'], encode: { x: 0, y: [2, 3], tooltip: [] },
    data: cells.map((cell, index) => [cell.b, cell.a, ...errors[index]]),
    renderItem: (_params: unknown, api: RenderApi) => {
      const low = center(api, Number(api.value(0)), Number(api.value(1)), Number(api.value(2)))
      const high = center(api, Number(api.value(0)), Number(api.value(1)), Number(api.value(3)))
      return errorShape(low[0], low[1], high[1], Math.min(7, barWidth(api) * 0.2))
    }, z: 4 }
  const annotationSeries = { name: 'annotations', type: 'custom' as const, silent: true, clip: false, tooltip: { show: false },
    dimensions: ['Left category', 'Left factor', 'Right category', 'Right factor', 'Anchor', 'Label', 'Tier'],
    encode: { x: [0, 2], y: 4, tooltip: [] },
    data: annotations.map((annotation, index) => [annotation.left.b, annotation.left.a, annotation.right.b, annotation.right.a, axis.max, annotation.label, index + 1]),
    renderItem: (_params: unknown, api: RenderApi) => {
      const left = center(api, Number(api.value(0)), Number(api.value(1)), Number(api.value(4)))
      const right = center(api, Number(api.value(2)), Number(api.value(3)), Number(api.value(4)))
      left[1] -= Number(api.value(6)) * bracketStep
      right[1] -= Number(api.value(6)) * bracketStep
      return { type: 'group' as const, children: [
        { type: 'polyline' as const, shape: { points: [[left[0], left[1] + 7], left, right, [right[0], right[1] + 7]] }, style: { stroke: ink, fill: 'none', lineWidth: 1.4 } },
        { type: 'text' as const, style: { text: String(api.value(5)), x: (left[0] + right[0]) / 2, y: left[1] - 7, align: 'center' as const, verticalAlign: 'bottom' as const, font: '600 12px sans-serif', fill: ink } },
      ] }
    }, z: 6 }
  const option: EChartsOption = { animation: false, backgroundColor: '#fff', grid: { left: leftMargin, right: 28, top, bottom },
    legend: { show: !!twoWay, type: 'scroll', top: 10, left: leftMargin, right: 28, data: twoWay?.factorA.levels ?? [], formatter: (value: string) => wrapChartLabel(value, 18), textStyle: { color: ink, lineHeight: 16 }, tooltip: { show: true } },
    tooltip: { trigger: 'item', renderMode: 'richText', formatter: params => {
      const data = (params as { data?: number[] }).data
      const cell = data && cells[data[3]]
      return cell ? cell.summary.name + '\nMean: ' + formatChartTick(cell.summary.mean) : ''
    } },
    xAxis: { type: 'category', data: categories, axisLabel: { interval: 0, color: ink, lineHeight: 16, formatter: (value: string) => wrapChartLabel(value, labelChars) }, axisLine: { onZero: false, lineStyle }, axisTick: { lineStyle }, splitLine: { show: false } },
    yAxis: numericYAxis(axis, 'Synthetic value'), series: [...bars, points, errorSeries, annotationSeries],
  }
  return { option, width, height }
}

export function buildTimeSeriesChart(candidate: TimeSeriesCandidate, settings: TimeSeriesGeneratorSettings, errorType: ErrorType, availableWidth: number): ChartPlan {
  const yTitle = wrapChartLabel(settings.yAxisTitle, 22)
  const right = 70
  const summaryAt = (group: number, time: number) => candidate.summaries.find(summary => summary.groupId === settings.groups[group].id && summary.timeId === settings.timePoints[time].id)
  const errorData = settings.groups.flatMap((_, group) => settings.timePoints.flatMap((time, index) => {
    const summary = summaryAt(group, index)
    return summary ? [[time.value, ...errorFor(summary, errorType), group]] : []
  }))
  const axis = chartNumericAxis([...candidate.values.flat(2), ...errorData.flatMap(item => item.slice(1, 3))], { includeZero: false, padding: 0.1 })
  const left = yAxisLayout(axis, yTitle).left
  const width = Math.ceil(Math.max(availableWidth, left + right + 240, Math.min(12, settings.timePoints.length) * 74 + left + right))
  const title = wrapChartLabel(settings.chartTitle, Math.max(20, Math.floor((width - 45) / 8)))
  const titleHeight = title.split('\n').length * 18
  const times = settings.timePoints.map(time => time.value)
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  const timeSpan = maxTime - minTime || 1
  // Label lanes retain real time spacing, including very close irregular visits.
  const rowEnds: number[] = []
  const rowHeights: number[] = []
  const labels = settings.timePoints.map(time => ({ ...time, text: wrapChartLabel(time.label, 14) }))
    .sort((a, b) => a.value - b.value).map(time => {
      const x = left + (time.value - minTime) / timeSpan * (width - left - right)
      const labelWidth = Math.max(...time.text.split('\n').map(line => Array.from(line).reduce((cells, character) => cells + ((character.codePointAt(0) ?? 0) > 255 ? 2 : 1), 0))) * 8
      let row = rowEnds.findIndex(end => x - labelWidth / 2 > end + 10)
      if (row < 0) row = rowEnds.length
      rowEnds[row] = x + labelWidth / 2
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, time.text.split('\n').length * 15 + 10)
      return { value: time.value, text: time.text, row }
    })
  const labelHeight = rowHeights.reduce((sum, height) => sum + height, 0)
  const xTitle = wrapChartLabel(settings.xAxisTitle, Math.max(20, Math.floor((width - left - right) / 8)))
  const bottom = 24 + labelHeight + xTitle.split('\n').length * 16
  const legendLines = Math.max(1, ...settings.groups.map(group => wrapChartLabel(group.name, 18).split('\n').length))
  const top = titleHeight + legendLines * 16 + 42
  const height = top + 300 + bottom
  const lines = settings.groups.map((group, groupIndex) => ({ id: group.id, name: group.name, type: 'line' as const, smooth: false, showSymbol: true, symbol: 'circle', symbolSize: 7,
    dimensions: ['Time', 'Mean'], encode: { x: 0, y: 1, tooltip: [1] },
    data: settings.timePoints.map((time, timeIndex) => {
      const summary = summaryAt(groupIndex, timeIndex)
      const values = candidate.values[groupIndex]?.[timeIndex] ?? []
      return [time.value, summary?.mean ?? values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)]
    }).sort((a, b) => a[0] - b[0]), lineStyle: { width: 2, color: group.color }, itemStyle: { color: group.color, borderColor: ink, borderWidth: 0.8 }, z: 3 }))
  const errorSeries = { name: 'error', type: 'custom' as const, silent: true, data: errorData, tooltip: { show: false },
    dimensions: ['Time', 'Low', 'High', 'Group'], encode: { x: 0, y: [1, 2], tooltip: [] },
    renderItem: (_params: unknown, api: RenderApi) => {
      const low = api.coord([Number(api.value(0)), Number(api.value(1))])
      const high = api.coord([Number(api.value(0)), Number(api.value(2))])
      return errorShape(low[0], low[1], high[1], 5)
    }, z: 4 }
  const timeLabels = { name: 'time labels', type: 'custom' as const, silent: true, clip: false, tooltip: { show: false },
    encode: { x: 0, y: 1, tooltip: [] },
    data: labels.map(label => [label.value, axis.min, label.text, rowHeights.slice(0, label.row).reduce((sum, height) => sum + height, 0)]),
    renderItem: (_params: unknown, api: RenderApi) => {
      const point = api.coord([Number(api.value(0)), Number(api.value(1))])
      return { type: 'text' as const, style: { text: String(api.value(2)), x: point[0], y: point[1] + 14 + Number(api.value(3)), align: 'center' as const, verticalAlign: 'top' as const, font: '12px sans-serif', lineHeight: 15, fill: ink } }
    }, z: 6 }
  const option: EChartsOption = { animation: false, backgroundColor: '#fff',
    title: { text: title, left: 20, top: 10, textStyle: { color: ink, fontSize: 14, lineHeight: 18, fontWeight: 600 } },
    legend: { type: 'scroll', top: titleHeight + 20, left: 20, right: 20, data: settings.groups.map(group => group.name), formatter: (value: string) => wrapChartLabel(value, 18), icon: 'circle', textStyle: { color: ink, fontSize: 12, lineHeight: 16 }, tooltip: { show: true } },
    grid: { left, right, top, bottom }, tooltip: { trigger: 'axis', renderMode: 'richText', formatter: params => {
      const items = (Array.isArray(params) ? params : [params]).filter(item => item.seriesType === 'line')
      if (!items.length) return ''
      const time = (items[0].data as number[])[0]
      return [settings.timePoints.find(point => point.value === time)?.label ?? formatChartTick(time),
        ...items.map(item => item.seriesName + ': ' + formatChartTick((item.data as number[])[1]))].join('\n')
    } },
    xAxis: { type: 'value', min: minTime, max: maxTime === minTime ? minTime + 1 : maxTime, name: xTitle, nameLocation: 'middle', nameGap: labelHeight + 26, nameTextStyle: { color: ink, lineHeight: 16 }, axisLabel: { show: false }, axisLine: { onZero: false, lineStyle }, axisTick: { show: false }, splitLine: { lineStyle: gridLine } },
    yAxis: numericYAxis(axis, yTitle), series: [...lines, errorSeries, timeLabels],
  }
  return { option, width, height }
}

export const ResultChart = forwardRef<ReactECharts, { candidate: Candidate | TimeSeriesCandidate; settings: GeneratorSettings | TimeSeriesGeneratorSettings; errorType: ErrorType }>(({ candidate, settings, errorType }, chartRef) => {
  const { ref, width } = useChartWidth<HTMLDivElement>()
  const plan = 'design' in settings
    ? buildTimeSeriesChart(candidate as TimeSeriesCandidate, settings, errorType, width)
    : buildBarChart(candidate as Candidate, settings, errorType, width)
  return <div ref={ref} className="stat-chart-scroll" style={{ width: '100%', minWidth: 0, overflowX: 'auto', background: '#fff' }}>
    <ReactECharts ref={chartRef} option={plan.option} style={{ width: plan.width, height: plan.height }} notMerge />
  </div>
})
