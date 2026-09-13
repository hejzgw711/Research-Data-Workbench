import { describe, expect, it } from 'vitest'
import { chartNumericAxis, formatChartTick, wrapChartLabel } from './chartDisplay'

describe('display-only automatic axes', () => {
  for (const values of [[0, 0], [1e-7, 2.4e-7], [-.003, .006], [-9, -2], [1e7, 4e7], [1e6, 1e6 + .01], [1e6, 1e6 + 1e-8], [3, 3]]) {
    for (const includeZero of [false, true]) it('contains ' + values.join(',') + ' with zero=' + includeZero, () => {
      const original = [...values]
      const axis = chartNumericAxis(values, { includeZero })
      expect(axis.min).toBeLessThanOrEqual(Math.min(...values))
      expect(axis.max).toBeGreaterThanOrEqual(Math.max(...values))
      expect(axis.max).toBeGreaterThan(axis.min)
      expect(axis.interval).toBeGreaterThan(0)
      if (includeZero) { expect(axis.min).toBeLessThanOrEqual(0); expect(axis.max).toBeGreaterThanOrEqual(0) }
      const labels = axis.ticks.map(value => formatChartTick(value, axis.interval))
      expect(new Set(labels).size).toBe(labels.length)
      expect(axis.ticks.length).toBeLessThanOrEqual(12)
      expect(values).toEqual(original)
    })
  }
  it('keeps tiny data visible without imposing a one-unit span', () => {
    const axis = chartNumericAxis([1e-7, 2e-7])
    expect(axis.max).toBeLessThan(1e-6)
    expect(formatChartTick(1e-7, axis.interval)).not.toBe('0')
  })
  it('handles missing and non-finite display inputs', () => {
    expect(chartNumericAxis([NaN, Infinity, -Infinity])).toEqual(chartNumericAxis([]))
    expect(chartNumericAxis([NaN, 2])).toEqual(chartNumericAxis([2]))
    expect(formatChartTick(NaN)).toBe('')
  })
  it('wraps complete Latin and CJK labels without truncation', () => {
    for (const label of ['Long treatment group 123', '术后第十二天联合治疗分组', '😀😀中文标签']) {
      const wrapped = wrapChartLabel(label, 10)
      expect(wrapped.replaceAll('\n', '')).toBe(label)
      expect(wrapped).toContain('\n')
    }
  })
})
