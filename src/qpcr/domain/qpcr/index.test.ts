import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../../defaults'
import type { QPCRProject } from '../../models'
import { amplificationCurve, geometricMean, holmAdjust, MAX_WELLS, mean, meltingCurve, normalFor, randomFor, sampleSD, significance, simulate, validatePlateWells, welchTest } from './index'

function manualFixture(): QPCRProject {
  const project = createDefaultProject()
  project.groups = project.groups.slice(0, 2)
  project.comparisons = project.comparisons.slice(0, 1)
  project.inputMode = 'manual'
  for (const [groupIndex, group] of project.groups.entries()) {
    group.technicalReplicates = 2
    for (let bio = 1; bio <= 3; bio++) for (let tech = 1; tech <= 2; tech++) {
      project.manualCq[`${group.id}/${bio}/ref1/${tech}`] = 18
      project.manualCq[`${group.id}/${bio}/target1/${tech}`] = 23 + bio - groupIndex
    }
  }
  return project
}

describe('deterministic primitives and summaries', () => {
  it('uses stable key-specific substreams bounded away from 0 and 1', () => {
    expect(randomFor(17, 'sample/a')).toBe(randomFor(17, 'sample/a'))
    expect(randomFor(17, 'sample/a')).not.toBe(randomFor(17, 'sample/b'))
    expect(randomFor(18, 'sample/a')).not.toBe(randomFor(17, 'sample/a'))
    for (let i = 0; i < 100; i++) {
      expect(randomFor(i, 'value')).toBeGreaterThan(0)
      expect(randomFor(i, 'value')).toBeLessThan(1)
      expect(Number.isFinite(normalFor(i, 'value'))).toBe(true)
    }
  })

  it('calculates sample summaries without masking undefined SD', () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(sampleSD([1, 2, 3])).toBe(1)
    expect(geometricMean([0.5, 1, 2])).toBeCloseTo(1, 14)
    expect(sampleSD([2])).toBeNaN()
    expect(mean([])).toBeNaN()
    expect(geometricMean([0, 1])).toBeNaN()
  })

  it('matches the two-sided Student-t reference fixture', () => {
    // Welch reduces to df=8, |t|=1 here; reference from scipy.stats.ttest_ind.
    const stats = welchTest([1, 2, 3, 4, 5], [2, 3, 4, 5, 6])
    expect(stats.status).toBe('ok')
    expect(stats.statistic).toBeCloseTo(-1, 13)
    expect(stats.df).toBeCloseTo(8, 13)
    expect(stats.p).toBeCloseTo(0.34659350708733416, 10)
    expect(welchTest([1, 1], [2, 2]).status).toBe('not_applicable')
    expect(welchTest([1, 1], [1, 1]).p).toBeNull()
    expect(welchTest([1], [2, 3]).p).toBeNull()
    expect(welchTest([1, NaN], [2, 3]).p).toBeNull()
    expect(welchTest([1, 1, 1], [2, 3, 4]).status).toBe('ok')
  })

  it('keeps significance boundaries and Holm family correction explicit', () => {
    expect([0.1, 0.05, 0.049, 0.01, 0.009, 0.001, 0.0009, 0.0001, 0.00009, null].map(significance))
      .toEqual(['ns', 'ns', '*', '*', '**', '**', '***', '***', '****', '—'])
    expect(holmAdjust([0.01, 0.04, null, 0.03])).toEqual([0.03, 0.06, null, 0.06])
  })
})

describe('qPCR measurement and normalization chain', () => {
  it('replays identical configuration and seed with identical results', () => {
    const project = createDefaultProject()
    const first = simulate(project)
    expect(simulate(structuredClone(project))).toEqual(first)
    project.theme = 'dark'
    project.name = 'metadata edit'
    expect(simulate(project)).toEqual(first)
    project.randomSeed++
    expect(simulate(project).wells[0].values).not.toEqual(first.wells[0].values)
  })

  it('aggregates technical repeats before biological ΔCq and counts only animals', () => {
    const result = simulate(manualFixture())
    expect(result.wells).toHaveLength(24)
    expect(result.samples).toHaveLength(6)
    const control = result.groups.find(group => group.groupId === 'g1')!
    expect(control.n).toBe(3)
    expect(control.deltaCqs).toEqual([6, 7, 8])
    expect(control.folds).toEqual([2, 1, 0.5])
    expect(control.mean).toBeCloseTo(7 / 6, 13)
    expect(control.geometricMean).toBeCloseTo(1, 13)
    expect(result.samples[0]).toMatchObject({ referenceCq: 18, targetCq: 24, deltaCq: 6, deltaDeltaCq: -1, fold: 2, technicalN: 2, inferential: true })
    const treatment = result.groups.find(group => group.groupId === 'g2')!
    expect(treatment.folds).toEqual([4, 2, 1])
    expect(result.comparisons[0].rawP).toBeCloseTo(welchTest([6, 7, 8], [5, 6, 7]).p!, 13)
  })

  it('uses full precision before averaging technical Cq', () => {
    const project = manualFixture()
    project.manualCq['g1/1/ref1/2'] = 18.000023
    project.manualCq['g1/1/target1/2'] = 24.000037
    const sample = simulate(project).samples[0]
    expect(sample.referenceCq).toBeCloseTo(18.0000115, 13)
    expect(sample.targetCq).toBeCloseTo(24.0000185, 13)
    expect(sample.deltaCq).toBeCloseTo(6.000007, 13)
  })

  it('maps arithmetic lognormal mean and SD to log-fold before constructing target Cq', () => {
    const project = createDefaultProject()
    project.simulation.referenceCqSD = 0
    project.groups[1].technicalCqSD = 0
    project.groups[1].targetFoldByGene.target1 = { mean: 4, sd: 1, sdMode: 'manual' }
    const sigma = Math.sqrt(Math.log1p(1 / 16))
    const mu = Math.log(4) - sigma ** 2 / 2
    const z = normalFor(project.randomSeed, 'g2/1/target1/expression/bio/row-0')
    const expectedCq = 24 - (mu + sigma * z) / Math.LN2
    const wells = simulate(project).wells.filter(well => well.groupId === 'g2' && well.biologicalReplicate === 1 && well.geneId === 'target1')
    expect(wells).toHaveLength(3)
    for (const well of wells) expect(well.values.cq).toBeCloseTo(expectedCq, 13)
  })

  it('keeps control geometric mean one for every target gene', () => {
    const project = createDefaultProject()
    project.genes.push({ ...project.genes[1], id: 'target2', name: 'TNF', nominalCq: 26 })
    const result = simulate(project)
    for (const group of result.groups.filter(group => group.groupId === 'g1')) expect(group.geometricMean).toBeCloseTo(1, 12)
    expect(result.comparisons).toHaveLength(6)
    expect(result.comparisons.every(comparison => comparison.p! >= comparison.rawP!)).toBe(true)
  })

  it('applies noise and precision presets without resetting user-specified fold distributions', () => {
    const project = createDefaultProject()
    const baseline = simulate(project).wells[0]
    project.simulation.preset = 'precision'
    const precision = simulate(project).wells[0]
    expect(precision.values.noise).toBeCloseTo(baseline.values.noise / 4, 14)
    expect(precision.values.cq - project.genes[0].nominalCq).toBeCloseTo((baseline.values.cq - project.genes[0].nominalCq) / 4, 13)
    expect(precision.values.tm - project.genes[0].tmC).toBeCloseTo((baseline.values.tm - project.genes[0].tmC) / 4, 13)
    project.simulation.preset = 'realistic'
    project.simulation.noiseLevel = 'high'
    const noisy = simulate(project).wells[0]
    expect(noisy.values.noise).toBeCloseTo(baseline.values.noise * 1.75, 14)
    expect(noisy.values.cq - project.genes[0].nominalCq).toBeCloseTo((baseline.values.cq - project.genes[0].nominalCq) * 1.75, 13)
    expect(project.groups[1].targetFoldByGene.target1).toEqual({ mean: 2, sd: 0.3, sdMode: 'manual' })
  })

  it('regenerates only the named group/gene raw values with a row sub-seed', () => {
    const project = createDefaultProject()
    const before = simulate(project)
    project.rowSeeds['g2/target1'] = 1
    const after = simulate(project)
    for (let i = 0; i < before.wells.length; i++) {
      const changed = before.wells[i].groupId === 'g2' && before.wells[i].geneId === 'target1'
      if (changed) expect(after.wells[i].values).not.toEqual(before.wells[i].values)
      else expect(after.wells[i].values).toEqual(before.wells[i].values)
    }
  })

  it('preserves existing sample draws after an unrelated group is inserted first', () => {
    const project = createDefaultProject()
    const before = simulate(project)
    project.groups.unshift({ ...structuredClone(project.groups[1]), id: 'extra', name: 'Extra' })
    const after = simulate(project)
    for (const well of before.wells) expect(after.wells.find(item => item.key === well.key)?.values).toEqual(well.values)
  })

  it('labels technical-only preview as non-inferential', () => {
    const project = createDefaultProject()
    project.replicateMode = 'technical'
    const result = simulate(project)
    expect(result.wells).toHaveLength(24)
    expect(result.samples).toHaveLength(12)
    expect(result.samples.every(sample => !sample.inferential)).toBe(true)
    expect(result.comparisons.every(comparison => !comparison.inferential)).toBe(true)
    expect(result.qc.some(issue => issue.id === 'technical-preview')).toBe(true)
  })

  it('does not use many technical repeats to manufacture biological n', () => {
    const project = createDefaultProject()
    project.groups.forEach(group => { group.biologicalReplicates = 1; group.technicalReplicates = 12 })
    const result = simulate(project)
    expect(result.groups.every(group => group.n === 1)).toBe(true)
    expect(result.comparisons.every(comparison => comparison.status === 'not_applicable' && comparison.p === null)).toBe(true)
  })
})

describe('QC, overrides and plates', () => {
  it('excludes wells before aggregation and reports missing reference chains', () => {
    const project = manualFixture()
    project.manualOverrides['g1/1/ref1/1'] = { excluded: true }
    let result = simulate(project)
    expect(result.samples[0].technicalN).toBe(1)
    project.manualOverrides['g1/1/ref1/2'] = { excluded: true }
    result = simulate(project)
    expect(result.groups.find(group => group.groupId === 'g1')?.n).toBe(2)
    expect(result.samples.some(sample => sample.id === 'g1/1/target1')).toBe(false)
    expect(result.qc.some(issue => issue.id.startsWith('missing/') && issue.level === 'fail')).toBe(true)
  })

  it('reports missing manual input without substituting simulated values', () => {
    const project = manualFixture()
    delete project.manualCq['g1/1/ref1/1']
    delete project.manualCq['g1/1/ref1/2']
    const result = simulate(project)
    expect(result.wells[0].values.cq).toBeNaN()
    expect(result.groups[0].n).toBe(2)
    expect(result.qc.some(issue => issue.id.startsWith('manual-missing/'))).toBe(true)
  })

  it('never silently substitutes a calibration baseline when the control is missing', () => {
    const project = manualFixture()
    for (let bio = 1; bio <= 3; bio++) for (let tech = 1; tech <= 2; tech++) project.manualOverrides[`g1/${bio}/ref1/${tech}`] = { excluded: true }
    const result = simulate(project)
    expect(result.samples).toHaveLength(0)
    expect(result.comparisons[0].p).toBeNull()
    expect(result.qc.some(issue => issue.id === 'calibration/target1' && issue.level === 'fail')).toBe(true)
  })

  it('detects technical spread, MAD outliers, Tm deviations and invalid Cq', () => {
    const project = createDefaultProject()
    for (let tech = 1; tech <= 3; tech++) project.manualOverrides[`g1/1/ref1/${tech}`] = { cq: tech === 3 ? 21 : 18 }
    project.manualOverrides['g1/1/target1/1'] = { tm: project.genes[1].tmC + 2 }
    project.manualOverrides['g2/1/ref1/1'] = { cq: 90 }
    const result = simulate(project)
    for (const prefix of ['technical-sd/', 'cq-outlier/', 'tm/', 'cq-range/']) expect(result.qc.some(issue => issue.id.startsWith(prefix))).toBe(true)
  })

  it('keeps generated values intact for restore actions', () => {
    const project = createDefaultProject()
    const baseline = simulate(project).wells[0]
    project.manualOverrides[baseline.key] = { cq: 19, tm: 87 }
    const changed = simulate(project).wells[0]
    expect(changed.generated).toEqual(baseline.generated)
    expect(changed.values.cq).toBe(19)
    expect(changed.adjusted).toBe(true)
    delete project.manualOverrides[baseline.key]
    expect(simulate(project).wells[0]).toEqual(baseline)
  })

  it('allocates row-major 96-well plates, with unique ids across overflow', () => {
    const project = createDefaultProject()
    project.groups.forEach(group => { group.biologicalReplicates = 5 })
    const result = simulate(project)
    expect(result.totalWells).toBe(120)
    expect(result.plateCount).toBe(2)
    expect(result.wells[95]).toMatchObject({ id: '1/H12', plateIndex: 0, wellId: 'H12' })
    expect(result.wells[96]).toMatchObject({ id: '2/A1', plateIndex: 1, wellId: 'A1' })
    expect(new Set(result.wells.map(well => well.id)).size).toBe(120)
    expect(validatePlateWells(result.wells)).toEqual([])
    expect(validatePlateWells([result.wells[0], result.wells[0]])[0].level).toBe('fail')
  })

  it('returns structured validation failures for unsupported dimensions', () => {
    const project = createDefaultProject()
    project.groups[0].biologicalReplicates = 0
    expect(simulate(project).qc[0].level).toBe('fail')
    project.groups[0].biologicalReplicates = MAX_WELLS
    expect(simulate(project).qc.some(issue => issue.id === 'capacity')).toBe(true)
    project.groups[0].biologicalReplicates = 3
    project.genes = project.genes.filter(gene => gene.type !== 'reference')
    expect(simulate(project).qc.some(issue => issue.id === 'reference-definition')).toBe(true)
  })
})

describe('parameter-based synthetic curves', () => {
  it('aligns the noise-free fixed threshold at integer Cq', () => {
    const project = createDefaultProject()
    project.protocol.cqDetection.mode = 'fixed-threshold'
    project.manualOverrides['g1/1/target1/1'] = { cq: 24, baseline: 0.02, plateau: 1, slope: 1, noise: 0 }
    const well = simulate(project).wells.find(item => item.key === 'g1/1/target1/1')!
    const curve = amplificationCurve(well, project)
    expect(curve).toHaveLength(40)
    expect(curve.find(point => point.x === 24)!.y).toBeCloseTo(0.1, 13)
    expect(curve[39].y).toBeGreaterThan(curve[0].y)
    expect(amplificationCurve(well, project)).toEqual(curve)
  })

  it('aligns ΔF against the configured baseline-cycle mean', () => {
    const project = createDefaultProject()
    project.manualOverrides['g1/1/target1/1'] = { cq: 24, baseline: 0.02, plateau: 1, slope: 0.4, noise: 0 }
    const well = simulate(project).wells.find(item => item.key === 'g1/1/target1/1')!
    const curve = amplificationCurve(well, project)
    const baseline = mean(curve.filter(point => point.x >= 3 && point.x <= 10).map(point => point.y))
    expect(curve.find(point => point.x === 24)!.y - baseline).toBeCloseTo(0.1, 12)
    project.protocol.cqDetection.baselineEndCycle = 14
    const shifted = amplificationCurve(well, project)
    expect(shifted).not.toEqual(curve)
    const laterBaseline = mean(shifted.filter(point => point.x >= 3 && point.x <= 14).map(point => point.y))
    expect(shifted.find(point => point.x === 24)!.y - laterBaseline).toBeCloseTo(0.1, 12)
  })

  it('shows threshold alignment failure as QC and does not fabricate extracted Cq', () => {
    const project = createDefaultProject()
    project.protocol.cqDetection.threshold = 10
    const result = simulate(project)
    expect(result.qc.some(issue => issue.id === 'threshold-alignment')).toBe(true)
    expect(amplificationCurve(result.wells[0], project).every(point => Number.isFinite(point.y))).toBe(true)
  })

  it('melting peak follows Tm, FWHM, amplitude and protocol sampling', () => {
    const project = createDefaultProject()
    project.simulation.curveModel = 'legacy-v1'
    project.protocol.readingsPerC = 10
    project.manualOverrides['g1/1/target1/1'] = { tm: 84, fwhm: 2, plateau: 1, noise: 0 }
    const well = simulate(project).wells.find(item => item.key === 'g1/1/target1/1')!
    const curve = meltingCurve(well, project)
    expect(curve).toHaveLength(351)
    const peak = curve.reduce((a, b) => a.y > b.y ? a : b)
    expect(peak.x).toBe(84)
    expect(peak.y).toBeCloseTo(project.protocol.meltFactor, 13)
    expect(curve.find(point => point.x === 83)!.y / peak.y).toBeCloseTo(0.5, 6)
    expect(meltingCurve(well, project)).toEqual(curve)
    project.protocol.meltFactor = 2.4
    expect(meltingCurve(well, project).find(point => point.x === 84)!.y).toBeCloseTo(2.4, 13)
  })
})
