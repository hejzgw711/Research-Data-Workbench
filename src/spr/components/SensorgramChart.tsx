import ReactECharts from 'echarts-for-react'
import type { EChartsOption, SeriesOption } from 'echarts'
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

export default function SensorgramChart({
  result,
  mode,
  cycleId,
  curve,
}: SensorgramChartProps) {
  const selectedCycles =
    mode === 'overlay'
      ? result.cycles.filter((cycle) => cycle.plan.kind === 'sample')
      : result.cycles.filter((cycle) => cycle.plan.id === cycleId)

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

  const option: EChartsOption = {
    color: seriesColors,
    animation: false,
    grid: { top: 42, right: 26, bottom: 52, left: 72 },
    legend: {
      type: 'scroll',
      top: 2,
      right: 8,
      left: 8,
      textStyle: { color: '#52615f', fontSize: 11 },
      pageTextStyle: { color: '#52615f' },
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (value) => `${Number(value).toFixed(2)} RU`,
    },
    xAxis: {
      type: 'value',
      name: 'Injection-aligned time (s)',
      nameLocation: 'middle',
      nameGap: 34,
      axisLine: { lineStyle: { color: '#9baaa7' } },
      axisLabel: { color: '#687775' },
      splitLine: { lineStyle: { color: '#e6ecea' } },
    },
    yAxis: {
      type: 'value',
      name: 'Response (RU)',
      nameLocation: 'middle',
      nameGap: 52,
      axisLabel: { color: '#687775' },
      splitLine: { lineStyle: { color: '#e6ecea' } },
    },
    dataZoom: [
      { type: 'inside', filterMode: 'none' },
      { type: 'slider', height: 16, bottom: 8, borderColor: '#d9e2df' },
    ],
    series,
  }

  return (
    <ReactECharts
      option={option}
      style={{ width: '100%', height: 420 }}
      opts={{ renderer: 'canvas' }}
      aria-label="SPR sensorgram 响应曲线"
    />
  )
}
