import { describe, expect, it } from 'vitest'
import {
  defaultSettings,
  oneToOneResponse,
  parseConcentrations,
  simulateExperiment,
} from './simulator'

describe('SPR simulator', () => {
  it('converts micromolar concentrations to molar', () => {
    const values = parseConcentrations('0, 3.125, 100', 'uM')
    expect(values[0]).toBe(0)
    expect(values[1]).toBeCloseTo(3.125e-6, 12)
    expect(values[2]).toBeCloseTo(100e-6, 12)
  })

  it('computes the expected KD', () => {
    const result = simulateExperiment({ ...defaultSettings, noiseSDRU: 0 })
    expect(result.kdM).toBeCloseTo(6e-6, 12)
  })

  it('returns zero ideal binding for zero concentration', () => {
    expect(oneToOneResponse(0, 2500, 0.015, 800, 60)).toBe(0)
  })

  it('increases ideal response with concentration', () => {
    const low = oneToOneResponse(3.125e-6, 2500, 0.015, 800, 60)
    const high = oneToOneResponse(100e-6, 2500, 0.015, 800, 60)
    expect(high).toBeGreaterThan(low)
  })

  it('reproduces every generated numeric point for the same seed', () => {
    const first = simulateExperiment(defaultSettings).points.map((point) => point.fc2RU)
    const second = simulateExperiment(defaultSettings).points.map((point) => point.fc2RU)
    expect(second).toEqual(first)
  })

  it('creates all configured cycle types and finite outputs', () => {
    const result = simulateExperiment(defaultSettings)
    expect(result.cycles).toHaveLength(19)
    expect(result.sampleCycleCount).toBe(14)
    expect(result.points).toHaveLength(19 * 432)
    expect(result.points.every((point) => Number.isFinite(point.doubleReferencedRU))).toBe(true)
  })
})
