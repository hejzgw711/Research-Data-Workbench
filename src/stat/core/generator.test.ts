import { describe, expect, it } from 'vitest'
import { cloneSettings, defaultSettings, generateCandidates } from './generator'
import { formatValue } from './random'
import { runOneWayAnova, runTTest, runTwoWayAnova } from './statistics'

describe('constraint random generator', () => {
  it('reproduces identical candidates when the seed is locked', () => {
    const settings = cloneSettings(defaultSettings); settings.seedMode = 'locked'; settings.seed = 'locked-test-seed'
    expect(generateCandidates(settings).candidates.map((item) => item.values)).toEqual(generateCandidates(settings).candidates.map((item) => item.values))
  })

  it('recalculates a passing p value from final rounded values', () => {
    const settings = cloneSettings(defaultSettings); settings.seedMode = 'locked'; settings.seed = 'rounded-test'
    const candidate = generateCandidates(settings).candidates[0]
    const recalculated = runTTest(candidate.values[0], candidate.values[1], 'welch', settings.tail)
    expect(candidate.status).toBe('PASS'); expect(recalculated.pValue).toBe(candidate.test.pValue); expect(recalculated.pValue).toBeGreaterThanOrEqual(settings.targetPMin); expect(recalculated.pValue).toBeLessThanOrEqual(settings.targetPMax)
  })

  it('honors integer and range constraints after formatting', () => {
    const settings = cloneSettings(defaultSettings); settings.seedMode = 'locked'; settings.seed = 'integer-test'; settings.dataType = 'integer'; settings.groups.forEach((group) => { group.minValue = 0; group.maxValue = 30; group.targetSd = 2 }); settings.effectMin = 1; settings.effectMax = 8
    const candidate = generateCandidates(settings).candidates[0]
    expect(candidate.status).toBe('PASS'); expect(candidate.values.flat().every(Number.isInteger)).toBe(true); expect(candidate.values.flat().every((value) => value >= 0 && value <= 30)).toBe(true)
  })

  it('uses paired differences for a paired t-test', () => {
    const settings = cloneSettings(defaultSettings); settings.method = 'paired'; settings.seedMode = 'locked'; settings.seed = 'paired-test'
    const candidate = generateCandidates(settings).candidates[0]
    expect(candidate.test.degreesOfFreedom).toBe(7); expect(candidate.test.method).toBe('paired')
  })

  it('uses a new master seed in random mode', () => {
    const settings = cloneSettings(defaultSettings); settings.seedMode = 'random'
    expect(generateCandidates(settings).settings.seed).not.toBe(generateCandidates(settings).settings.seed)
  })

  it('switches to one-way ANOVA for three groups and recalculates the same p value', () => {
    const settings = cloneSettings(defaultSettings); settings.groups.push({ id: 'group-3', name: 'High', n: 6, meanOffset: 3, targetMean: 13, minValue: 0, maxValue: 30, targetSd: 1.2, color: '#b7d8aa' }); settings.method = 'anova'; settings.seedMode = 'locked'; settings.seed = 'anova-test'; settings.pairwiseConstraints = settings.pairwiseConstraints.concat([{ id: 'group-1::group-3', leftGroupId: 'group-1', rightGroupId: 'group-3', pMin: 0.001, pMax: 0.05 }, { id: 'group-2::group-3', leftGroupId: 'group-2', rightGroupId: 'group-3', pMin: 0.001, pMax: 0.05 }])
    const candidate = generateCandidates(settings).candidates[0]
    const recalculated = runOneWayAnova(settings.groups.map((group, index) => ({ id: group.id, name: group.name, values: candidate.values[index] })))
    expect(candidate.status).toBe('PASS'); expect(candidate.test.method).toBe('anova'); expect(recalculated.pValue).toBe(candidate.test.pValue); expect(candidate.test.pairwise).toHaveLength(3)
  })

  it('does not require an unchecked pairwise constraint', () => {
    const settings = cloneSettings(defaultSettings); settings.seedMode = 'locked'; settings.seed = 'unchecked-pair'; settings.pairwiseConstraints[0].enabled = false; settings.pairwiseConstraints[0].pMin = 0.99; settings.pairwiseConstraints[0].pMax = 1
    const candidate = generateCandidates(settings).candidates[0]
    expect(candidate.status).toBe('PASS')
    expect(candidate.checks.find((check) => check.label === 'Control vs Treatment p')).toMatchObject({ status: 'WARN' })
  })

  it('supports lognormal values with no maximum bound', () => {
    const settings = cloneSettings(defaultSettings); settings.seedMode = 'locked'; settings.seed = 'lognormal-preview'; settings.distribution = 'lognormal'; settings.trend = 'custom'; settings.pairwiseConstraints[0].enabled = false; settings.groups.forEach((group) => { group.maxValue = null })
    const candidate = generateCandidates(settings, 1).candidates[0]
    expect(candidate.values.flat().every((value) => value > 0)).toBe(true)
    expect(candidate.checks.filter((check) => check.label.endsWith('范围')).every((check) => check.status === 'PASS')).toBe(true)
  })

  it('leaves decimal values unrounded when decimal places are unrestricted', () => {
    expect(formatValue(1.23456789, 'decimal', null)).toBe(1.23456789)
  })

  it('generates a dynamic m by k two-way design and reports three effects', () => {
    const settings = cloneSettings(defaultSettings)
    settings.analysisDesign = 'twoWay'
    settings.twoWay = { factorA: { name: 'Model', levels: ['Sham', 'TBI', 'Recovery'] }, factorB: { name: 'Treatment', levels: ['NC', 'KO'] }, cells: [] }
    settings.twoWay.cells = settings.twoWay.factorA.levels.flatMap((_, factorAIndex) => settings.twoWay!.factorB.levels.map((_, factorBIndex) => ({ id: `cell-${factorAIndex}-${factorBIndex}`, factorAIndex, factorBIndex, n: 6, targetMean: 10 + factorAIndex * 2 + factorBIndex, minValue: 0, maxValue: 30, targetSd: 1.2, color: '#9acddb' })))
    settings.pairwiseConstraints = [{ id: 'cell-0-0::cell-0-1', leftGroupId: 'cell-0-0', rightGroupId: 'cell-0-1', enabled: true, pMin: 0, pMax: 1 }]
    settings.seedMode = 'locked'; settings.seed = 'two-way-test'; settings.maxAttempts = 50000
    const candidate = generateCandidates(settings, 1).candidates[0]
    const recalculated = runTwoWayAnova(settings.twoWay.cells.map((cell, index) => ({ factorAIndex: cell.factorAIndex, factorBIndex: cell.factorBIndex, values: candidate.values[index] })), 'Model', ['Sham', 'TBI', 'Recovery'], 'Treatment', ['NC', 'KO'])
    expect(candidate.status).toBe('PASS'); expect(candidate.test.design).toBe('two-way'); expect(candidate.test.pairwise).toHaveLength(15); expect(candidate.test.twoWay?.factorA.pValue).toBe(recalculated.twoWay?.factorA.pValue); expect(candidate.test.twoWay?.factorB.pValue).toBe(recalculated.twoWay?.factorB.pValue); expect(candidate.test.twoWay?.interaction.pValue).toBe(recalculated.twoWay?.interaction.pValue)
  })
})
