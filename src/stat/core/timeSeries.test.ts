import { describe, expect, it } from 'vitest'
import {
  defaultTimeSeriesSettings,
  generateTimeSeriesCandidates,
  runRepeatedMeasuresTwoWayAnova,
  syncTimeSeriesCells,
} from './timeSeries'
import type { TimeSeriesGeneratorSettings } from '../models'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('behavioural time-series generator', () => {
  it('keeps a dynamic group x time cell matrix', () => {
    const settings = clone(defaultTimeSeriesSettings)
    settings.groups.push({ id: 'ts-group-3', name: 'Recovery', n: 8, color: '#b7d8aa' })
    settings.timePoints.push({ id: 'ts-time-14', value: 14, label: 'Day 14' })
    syncTimeSeriesCells(settings)
    expect(settings.cells).toHaveLength(3 * 5)
    expect(new Set(settings.cells.map((cell) => `${cell.groupIndex}:${cell.timeIndex}`)).size).toBe(15)
  })

  it('reports repeated-measures degrees of freedom for a balanced matrix', () => {
    const values = [
      [[9, 10, 11, 10], [10, 11, 12, 11], [12, 13, 14, 13]],
      [[10, 11, 10, 11], [13, 14, 13, 14], [17, 18, 17, 18]],
    ]
    const result = runRepeatedMeasuresTwoWayAnova(values, 'Group', 'Day', ['Control', 'Treatment'], ['D0', 'D1', 'D2'])
    expect(result.design).toBe('repeated-two-way')
    expect(result.twoWay.group.degreesOfFreedom).toBe(1)
    expect(result.twoWay.time.degreesOfFreedom).toBe(2)
    expect(result.twoWay.interaction.degreesOfFreedom).toBe(2)
    expect(result.twoWay.subjectResidualDegreesOfFreedom).toBe(6)
    expect(result.twoWay.residualDegreesOfFreedom).toBe(12)
    expect(result.twoWay.totalDegreesOfFreedom).toBe(23)
    expect(result.pairwise).toHaveLength(3)
    expect(result.twoWay.interaction.pValue).toBeGreaterThanOrEqual(0)
    expect(result.twoWay.interaction.pValue).toBeLessThanOrEqual(1)
  })

  it('is reproducible with a locked seed and respects cell ranges', () => {
    const settings = clone(defaultTimeSeriesSettings)
    settings.seedMode = 'locked'
    settings.seed = 'time-series-test'
    settings.cells.forEach((cell) => { cell.minValue = 0; cell.maxValue = 50 })
    const left = generateTimeSeriesCandidates(settings, 2)
    const right = generateTimeSeriesCandidates(settings, 2)
    expect(left.candidates.map((candidate) => candidate.values)).toEqual(right.candidates.map((candidate) => candidate.values))
    expect(left.candidates[0].values.flat(2).every((value) => value >= 0 && value <= 50)).toBe(true)
    expect([left.candidates[0].test.twoWay.group, left.candidates[0].test.twoWay.time, left.candidates[0].test.twoWay.interaction].every((effect) => Number.isFinite(effect.pValue))).toBe(true)
  })

  it('rejects unequal subject counts in repeated-measures settings', () => {
    const settings = clone(defaultTimeSeriesSettings) as TimeSeriesGeneratorSettings
    settings.groups[1].n = 7
    expect(() => generateTimeSeriesCandidates(settings, 1)).toThrow('每组 n 相同')
  })

  it('keeps formatted values inside fractional bounds', () => {
    const settings = clone(defaultTimeSeriesSettings)
    settings.seedMode = 'locked'
    settings.seed = 'fractional-bound'
    settings.decimals = 0
    settings.cells.forEach((cell) => { cell.targetMean = 0.49; cell.targetSd = 0.1; cell.minValue = 0; cell.maxValue = 0.5 })
    const candidate = generateTimeSeriesCandidates(settings, 1).candidates[0]
    expect(candidate.values.flat(2).every((value) => value >= 0 && value <= 0.5)).toBe(true)
  })
})
