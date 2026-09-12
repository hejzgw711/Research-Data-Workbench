import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../../defaults'
import type { CurvePoint, QPCRProject } from '../../models'
import { amplificationCurve, mean, meltingCurve, rawAmplificationData, rawMeltingData, sampleSD, simulate } from './index'

function projectForProfile(profile: 'reference-v1' | 'legacy-v1' = 'reference-v1'): QPCRProject {
  const project = createDefaultProject()
  project.simulation.curveModel = profile
  return project
}

function crossing(points: CurvePoint[], target: number, rising = true): number {
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const current = points[i]
    if ((rising ? previous.y <= target && current.y >= target : previous.y >= target && current.y <= target) && current.y !== previous.y) {
      return previous.x + (current.x - previous.x) * (target - previous.y) / (current.y - previous.y)
    }
  }
  return NaN
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

describe('reference-v1 optical model', () => {
  it('changes optical shapes without altering Cq, Tm or biological statistics', () => {
    const project = projectForProfile('legacy-v1')
    const legacy = simulate(project)
    project.simulation.curveModel = 'reference-v1'
    const reference = simulate(project)
    expect(reference.samples).toEqual(legacy.samples)
    expect(reference.groups).toEqual(legacy.groups)
    expect(reference.comparisons).toEqual(legacy.comparisons)
    expect(reference.wells.map(well => [well.values.cq, well.values.tm, well.values.fwhm])).toEqual(legacy.wells.map(well => [well.values.cq, well.values.tm, well.values.fwhm]))
    expect(reference.wells[0].values.slope).not.toEqual(legacy.wells[0].values.slope)
  })

  it('retains exact noise-free Cq alignment in fixed and baseline modes', () => {
    const project = projectForProfile()
    project.manualOverrides['g1/1/target1/1'] = { cq: 24, plateau: 1, baseline: 0.02, slope: 0.6, noise: 0 }
    for (const mode of ['fixed-threshold', 'baseline-delta-f'] as const) {
      project.protocol.cqDetection.mode = mode
      const well = simulate(project).wells.find(item => item.key === 'g1/1/target1/1')!
      const points = amplificationCurve(well, project)
      const baseline = mode === 'baseline-delta-f' ? mean(points.filter(point => point.x >= 3 && point.x <= 10).map(point => point.y)) : 0
      expect(points.find(point => point.x === 24)!.y - baseline).toBeCloseTo(0.1, 12)
      expect(points.every((point, index) => index === 0 || point.y >= points[index - 1].y)).toBe(true)
      expect(amplificationCurve(well, project)).toEqual(points)
    }
  })

  it('calibrates fixed-threshold Cq with a nonzero deterministic baseline drift', () => {
    const project = projectForProfile()
    project.protocol.cqDetection.mode = 'fixed-threshold'
    project.manualOverrides['g1/1/target1/1'] = { cq: 24, plateau: 1, baseline: 0.02, slope: 0.6, noise: 0.004 }
    const result = simulate(project)
    expect(result.qc.some(issue => issue.id === 'threshold-alignment')).toBe(false)
    const well = result.wells.find(item => item.key === 'g1/1/target1/1')!
    // Noisy crossing is approximate by design; Cq remains its configured latent value.
    expect(amplificationCurve(well, project).find(point => point.x === 24)!.y).toBeCloseTo(0.1, 2)
    expect(well.values.cq).toBe(24)
  })

  it('keeps dominant Tm and configured total FWHM under left/right asymmetry', () => {
    const project = projectForProfile()
    project.protocol.readingsPerC = 50
    project.manualOverrides['g1/1/target1/1'] = { tm: 84, fwhm: 2.6, plateau: 1, noise: 0 }
    const well = simulate(project).wells.find(item => item.key === 'g1/1/target1/1')!
    const points = meltingCurve(well, project)
    const peakIndex = points.reduce((best, point, index) => point.y > points[best].y ? index : best, 0)
    const peak = points[peakIndex]
    const background = 0.08 * project.protocol.meltFactor
    const half = background + (peak.y - background) / 2
    const left = crossing(points.slice(0, peakIndex + 1), half)
    const right = crossing(points.slice(peakIndex), half, false)
    expect(peak.x).toBe(84)
    expect(right - left).toBeCloseTo(2.6, 3)
    expect((right - peak.x) / (peak.x - left)).toBeGreaterThan(0.79)
    expect((right - peak.x) / (peak.x - left)).toBeLessThan(1.04)
    expect(peak.y).toBeCloseTo(1.08 * project.protocol.meltFactor, 12)
  })

  it('has broad rise widths and relative baseline noise consistent with the selected illustrative scale', () => {
    const project = projectForProfile()
    const result = simulate(project)
    const widths: number[] = []
    const noiseFractions: number[] = []
    for (const well of result.wells) {
      const points = amplificationCurve(well, project)
      const early = points.filter(point => point.x >= 3 && point.x <= 10)
      const baseline = mean(early.map(point => point.y))
      const amplitude = mean(points.slice(-3).map(point => point.y)) - baseline
      widths.push(crossing(points, baseline + 0.9 * amplitude) - crossing(points, baseline + 0.1 * amplitude))
      const xMean = mean(early.map(point => point.x))
      const drift = early.reduce((sum, point) => sum + (point.x - xMean) * (point.y - baseline), 0) / early.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0)
      const residuals = early.map(point => point.y - baseline - drift * (point.x - xMean))
      noiseFractions.push(sampleSD(residuals) / amplitude)
    }
    // Broad descriptive guardrails, not a fitted calibration or a distribution test.
    expect(median(widths)).toBeGreaterThan(6)
    expect(median(widths)).toBeLessThan(10.5)
    expect(median(noiseFractions)).toBeGreaterThan(0.0002)
    expect(median(noiseFractions)).toBeLessThan(0.002)
  })

  it('changes only the selected row curve substream on row regeneration', () => {
    const project = projectForProfile()
    const before = simulate(project)
    const beforeCurves = before.wells.map(well => amplificationCurve(well, project))
    project.rowSeeds['g2/target1'] = 5
    const after = simulate(project)
    after.wells.forEach((well, index) => {
      if (well.groupId === 'g2' && well.geneId === 'target1') expect(amplificationCurve(well, project)).not.toEqual(beforeCurves[index])
      else expect(amplificationCurve(well, project)).toEqual(beforeCurves[index])
    })
  })
})

describe('canonical raw measurement exports', () => {
  for (const profile of ['legacy-v1', 'reference-v1'] as const) {
    it(`${profile}: Rn/Delta Rn use the exact plotted signal and selected noisy baseline`, () => {
      const project = projectForProfile(profile)
      const well = simulate(project).wells[0]
      const curve = amplificationCurve(well, project)
      const rows = rawAmplificationData(well, project)
      const baseline = mean(curve.filter(point => point.x >= 3 && point.x <= 10).map(point => point.y))
      expect(rows.map(row => ({ x: row.cycle, y: row.rn }))).toEqual(curve)
      for (const row of rows) {
        expect(row.baseline).toBe(baseline)
        expect(row.deltaRn).toBe(row.rn - baseline)
      }
    })

    it(`${profile}: melt fluorescence integrates the exact plotted derivative with its actual grid`, () => {
      const project = projectForProfile(profile)
      project.protocol.readingsPerC = 3.7
      const well = simulate(project).wells[0]
      const curve = meltingCurve(well, project)
      const rows = rawMeltingData(well, project)
      expect(rows.map(row => ({ x: row.temperature, y: row.derivative }))).toEqual(curve)
      expect(rows.at(-1)!.fluorescence).toBe(well.values.baseline)
      expect(rows.every(row => Number.isFinite(row.fluorescence))).toBe(true)
      for (let i = 0; i < rows.length - 1; i++) {
        const current = rows[i], next = rows[i + 1]
        expect(current.fluorescence - next.fluorescence).toBeCloseTo((current.derivative + next.derivative) * (next.temperature - current.temperature) / 2, 13)
      }
    })
  }

  it('preserves excluded raw observations and leaves missing Cq signals absent', () => {
    const project = projectForProfile()
    const before = simulate(project).wells[0]
    const observations = rawAmplificationData(before, project)
    project.manualOverrides[before.key] = { excluded: true }
    const excluded = simulate(project).wells[0]
    expect(rawAmplificationData(excluded, project)).toEqual(observations)
    excluded.values.cq = NaN
    expect(rawAmplificationData(excluded, project)).toEqual([])
    // Valid Tm/peak settings independently support a synthetic melt observation.
    expect(rawMeltingData(excluded, project).length).toBeGreaterThan(0)
  })

  it('uses a constant fluorescence offset for extreme noise without clipping the derivative', () => {
    const project = projectForProfile('legacy-v1')
    const well = simulate(project).wells[0]
    well.values.noise = 0.2
    well.values.plateau = 0.0001
    well.values.baseline = 0
    const curve = meltingCurve(well, project)
    const rows = rawMeltingData(well, project)
    expect(curve.some(point => point.y < 0)).toBe(true)
    expect(rows.every(row => row.fluorescence >= 0)).toBe(true)
    expect(rows.at(-1)!.fluorescence).toBeGreaterThan(0)
    expect(rows.map(row => row.derivative)).toEqual(curve.map(point => point.y))
    for (let index = 0; index < rows.length - 1; index++) {
      const current = rows[index], next = rows[index + 1]
      expect(current.fluorescence - next.fluorescence).toBeCloseTo((current.derivative + next.derivative) * (next.temperature - current.temperature) / 2, 12)
    }
  })
})
