import { describe, expect, it } from 'vitest'
import type { EChartsOption } from 'echarts'
import { buildSensorgramOption } from './SensorgramChart'
import { defaultSettings, simulateExperiment } from '../core/simulator'
import type { SimulationResult } from '../core/types'

const result = simulateExperiment(defaultSettings)

function chartShape(option: EChartsOption) {
  return option as {
    grid: { top: number; bottom: number; left: number; right: number }
    legend: { type: string; orient: string; top: number; height: number; formatter: (name: string) => string }
    xAxis: { min: number; max: number; interval: number; nameGap: number }
    yAxis: { min: number; max: number; interval: number; axisLabel: { formatter: (value: number) => string } }
    tooltip: { valueFormatter: (value: number | number[]) => string }
    dataZoom: Array<{ type: string; height: number; bottom: number }>
    series: Array<{ name: string; data: number[][] }>
  }
}

function scaledResult(scale: number, offset = 0): SimulationResult {
  return {
    ...result,
    cycles: result.cycles.map((cycle) => ({
      ...cycle,
      points: cycle.points.map((point) => ({ ...point, doubleReferencedRU: point.doubleReferencedRU * scale + offset })),
    })),
  }
}

describe('SPR sensorgram display', () => {
  it('retains every selected curve and its original injection-aligned coordinates', () => {
    const before = JSON.stringify(result)
    const chart = chartShape(buildSensorgramOption({ result, mode: 'overlay', cycleId: 1, curve: 'doubleReferencedRU' }, 900))
    const samples = result.cycles.filter((cycle) => cycle.plan.kind === 'sample')
    expect(chart.series).toHaveLength(samples.length)
    samples.forEach((cycle, index) => {
      expect(chart.series[index].data).toEqual(cycle.points.map((point) => [point.timeAlignedS, point.doubleReferencedRU]))
    })
    expect(chart.xAxis.min).toBeLessThanOrEqual(-defaultSettings.baselineS)
    expect(chart.xAxis.max).toBeGreaterThanOrEqual(samples[0].points.at(-1)!.timeAlignedS)
    expect(JSON.stringify(result)).toBe(before)
  })

  it('keeps small nonzero responses visible on the axis and in tooltips', () => {
    const small = scaledResult(1e-10)
    const chart = chartShape(buildSensorgramOption({ result: small, mode: 'overlay', cycleId: 1, curve: 'doubleReferencedRU' }, 390))
    expect(chart.yAxis.interval).toBeGreaterThan(0)
    expect(chart.yAxis.max).toBeLessThan(1e-5)
    expect(chart.yAxis.axisLabel.formatter(chart.yAxis.interval)).not.toMatch(/^0(?:\.0+)?$/)
    expect(chart.tooltip.valueFormatter(1e-9)).not.toBe('0.00 RU')
    expect(chart.tooltip.valueFormatter([-72, 1e-9])).toBe(chart.tooltip.valueFormatter(1e-9))
  })

  it('fits negative baselines and large positive responses without changing them', () => {
    for (const data of [scaledResult(1, -1200), scaledResult(1e10, -1e12)]) {
      const chart = chartShape(buildSensorgramOption({ result: data, mode: 'overlay', cycleId: 1, curve: 'doubleReferencedRU' }, 720))
      const values = chart.series.flatMap((series) => series.data.map((point) => point[1]))
      expect(values.every((value) => chart.yAxis.min <= value && value <= chart.yAxis.max)).toBe(true)
      expect(Number.isFinite(chart.yAxis.interval)).toBe(true)
      expect(chart.yAxis.interval).toBeGreaterThan(0)
    }
  })

  it('uses the chosen single cycle for its data and response range', () => {
    const selected = result.cycles[3]
    const chart = chartShape(buildSensorgramOption({ result, mode: 'single', cycleId: selected.plan.id, curve: 'fc1RU' }, 900))
    expect(chart.series).toHaveLength(1)
    expect(chart.series[0].data).toEqual(selected.points.map((point) => [point.timeAlignedS, point.fc1RU]))
    expect(chart.yAxis.min).toBeGreaterThan(0)
    expect(selected.points.every((point) => chart.yAxis.min <= point.fc1RU && point.fc1RU <= chart.yAxis.max)).toBe(true)
  })

  it('reserves separate legend, axis-title and slider areas in both widths', () => {
    for (const width of [350, 900]) {
      const chart = chartShape(buildSensorgramOption({ result, mode: 'overlay', cycleId: 1, curve: 'doubleReferencedRU' }, width))
      expect(chart.legend.type).toBe('scroll')
      expect(chart.legend.orient).toBe(width < 620 ? 'vertical' : 'horizontal')
      expect(chart.grid.top).toBeGreaterThan(chart.legend.top + chart.legend.height)
      const slider = chart.dataZoom.find((zoom) => zoom.type === 'slider')!
      expect(chart.dataZoom.some((zoom) => zoom.type === 'inside')).toBe(true)
      expect(chart.grid.bottom - chart.xAxis.nameGap - 14).toBeGreaterThan(slider.bottom + slider.height)
      expect(chart.grid.left + chart.grid.right).toBeLessThan(width)
    }
  })

  it('wraps long legend labels while keeping their complete series names', () => {
    const name = 'Concentration 123456789 micromolar repeated measurement group A sample 12'
    const data = { ...result, cycles: result.cycles.map((cycle) => ({ ...cycle, plan: { ...cycle.plan, label: name } })) }
    const chart = chartShape(buildSensorgramOption({ result: data, mode: 'overlay', cycleId: 1, curve: 'doubleReferencedRU' }, 350))
    expect(chart.legend.formatter(name)).toContain('\n')
    expect(chart.series.every((series) => series.name === name)).toBe(true)
  })
})
