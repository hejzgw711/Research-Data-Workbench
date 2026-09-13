import ReactECharts from 'echarts-for-react'
import type { EChartsOption, SeriesOption } from 'echarts'
import { chartNumericAxis, formatChartTick, wrapChartLabel } from '../../chartDisplay'
import { useChartWidth } from '../../useChartWidth'
import type { CurveKey, SimulationResult } from '../core/types'

interface SensorgramChartProps {
  result: SimulationResult
  mode: 'overlay' | 'single'
  cycleId: number
  curve: CurveKey
}

const curveName: Record<CurveKey, string> = {
  modelTruthRU: 'Model truth',
  fc1RU: 'Fc1',
  fc2RU: 'Fc2',
  fc2MinusFc1RU: 'Fc2-Fc1',
  baselineCorrectedRU: 'Baseline corrected',
  doubleReferencedRU: 'Double referenced',
}

const seriesColors = [
  '#238a73',
  '#e06b5f',
  '#4479a6',
  '#c19132',
  '#8b6aa7',
  '#4f9b9c',
  '#a45d70',
]

export function buildSensorgramOption({
  result,
  mode,
  cycleId,
  curve,
}: SensorgramChartProps, width: number): EChartsOption {
  const compact = width < 620
  const selectedCycles =
    mode === 'overlay'
      ? result.cycles.filter((cycle) => cycle.plan.kind === 'sample')
      : result.cycles.filter((cycle) => cycle.plan.id === cycleId)
  const responseAxis = chartNumericAxis(selectedCycles.flatMap((cycle) => cycle.points.map((point) => point[curve])), { includeZero: false, padding: 0.06, targetTicks: 5 })
  const timeAxis = chartNumericAxis(selectedCycles.flatMap((cycle) => cycle.points.map((point) => point.timeAlignedS)), { includeZero: false, padding: 0, targetTicks: compact ? 5 : 6 })
  const tickWidth = Math.max(...responseAxis.ticks.map((value) => formatChartTick(value, responseAxis.interval).length), 3) * 7
  const left = Math.max(72, tickWidth + 40)
  const right = compact ? 20 : 28

  const series: SeriesOption[] = selectedCycles.map((cycle, index) => ({
    name: mode === 'overlay' ? cycle.plan.label : curveName[curve],
    type: 'line',
    showSymbol: false,
    smooth: false,
    animation: false,
    sampling: 'lttb',
    lineStyle: { width: mode === 'overlay' ? 1.5 : 2 },
    itemStyle: { color: seriesColors[index % seriesColors.length] },
    emphasis: { focus: 'series' },
    dimensions: ['Time_s', 'Response_RU'],
    encode: { x: 0, y: 1, tooltip: [1] },
    data: cycle.points.map((point) => [point.timeAlignedS, point[curve]]),
    markArea:
      index === 0
        ? {
            silent: true,
            itemStyle: { color: 'rgba(171, 214, 96, 0.10)' },
            data: [[{ xAxis: 0 }, { xAxis: result.settings.associationS }]],
          }
        : undefined,
  }))

  return {
    color: seriesColors,
    backgroundColor: '#ffffff',
    animation: false,
    grid: { top: compact ? 132 : 74, right, bottom: 110, left },
    legend: {
      type: 'scroll',
      orient: compact ? 'vertical' : 'horizontal',
      top: 12,
      height: compact ? 98 : 48,
      right: 16,
      left: 20,
      itemWidth: 18,
      itemHeight: 10,
      itemGap: 10,
      formatter: (name) => wrapChartLabel(name, compact ? 26 : 34),
      textStyle: { color: '#435651', fontSize: 11, lineHeight: 15 },
      pageTextStyle: { color: '#52615f' },
      tooltip: { show: true },
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (value) => `${formatChartTick(Number(Array.isArray(value) ? value[1] : value))} RU`,
    },
    xAxis: {
      type: 'value',
      name: 'Injection-aligned time (s)',
      nameLocation: 'middle',
      nameGap: 36,
      min: timeAxis.min,
      max: timeAxis.max,
      interval: timeAxis.interval,
      nameTextStyle: { color: '#435651', fontSize: 12 },
      axisLine: { lineStyle: { color: '#9baaa7' } },
      axisLabel: { color: '#52615f', hideOverlap: true, formatter: (value: number) => formatChartTick(value, timeAxis.interval) },
      splitLine: { lineStyle: { color: '#e6ecea' } },
    },
    yAxis: {
      type: 'value',
      name: 'Response (RU)',
      nameLocation: 'middle',
      nameGap: tickWidth + 20,
      nameTextStyle: { color: '#435651', fontSize: 12 },
      min: responseAxis.min,
      max: responseAxis.max,
      interval: responseAxis.interval,
      axisLabel: { color: '#52615f', margin: 10, formatter: (value: number) => formatChartTick(value, responseAxis.interval) },
      splitLine: { lineStyle: { color: '#e6ecea' } },
    },
    dataZoom: [
      { type: 'inside', filterMode: 'none' },
      { type: 'slider', height: 20, bottom: 16, left, right, borderColor: '#d9e2df', textStyle: { color: '#52615f' }, labelFormatter: (value: number) => formatChartTick(value, timeAxis.interval) },
    ],
    series,
  }
}

export default function SensorgramChart(props: SensorgramChartProps) {
  const { ref, width } = useChartWidth()
  const compact = width < 620

  return (
    <div ref={ref} aria-label="SPR sensorgram 响应曲线" style={{ width: '100%', minWidth: 0 }}>
      <ReactECharts
        option={buildSensorgramOption(props, width)}
        replaceMerge={['series']}
        style={{ width: '100%', height: compact ? 480 : 440 }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  )
}
