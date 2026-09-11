import type { PRNG } from 'seedrandom'
import type { Candidate, ConstraintCheck, GenerationReport, GeneratorSettings, GroupConfig, PairwiseConstraint } from '../models'
import { createRandomSeed, formatValue, normal, scopedRng, uniform } from './random'
import { runOneWayAnova, runPairwiseWelch, runTTest, runTwoWayAnova, sampleSd, summarize } from './statistics'

const colors = ['#9acddb', '#e7ad97', '#b7d8aa', '#c4b0dd', '#e3c58d', '#9fb5d8']

export function pairwiseId(leftGroupId: string, rightGroupId: string) { return `${leftGroupId}::${rightGroupId}` }

function twoWayCellName(settings: GeneratorSettings, cell: { factorAIndex: number; factorBIndex: number }) {
  const twoWay = settings.twoWay!
  return `${twoWay.factorA.levels[cell.factorAIndex]} · ${twoWay.factorB.levels[cell.factorBIndex]}`
}

export function syncTwoWayGroups(settings: GeneratorSettings) {
  if (settings.analysisDesign !== 'twoWay' || !settings.twoWay) return settings
  const current = new Map(settings.twoWay.cells.map((cell) => [cell.id, cell]))
  const cells = settings.twoWay.factorA.levels.flatMap((_, factorAIndex) => settings.twoWay!.factorB.levels.map((_, factorBIndex) => {
    const id = `cell-${factorAIndex}-${factorBIndex}`
    const previous = current.get(id)
    return previous ?? { id, factorAIndex, factorBIndex, n: 8, targetMean: 10 + factorAIndex + factorBIndex, minValue: 0, maxValue: null, targetSd: 1.2, color: colors[(factorAIndex * settings.twoWay!.factorB.levels.length + factorBIndex) % colors.length] }
  }))
  settings.twoWay.cells = cells
  settings.groups = cells.map((cell) => ({ id: cell.id, name: twoWayCellName(settings, cell), n: cell.n, meanOffset: cell.targetMean - cells[0].targetMean, targetMean: cell.targetMean, minValue: cell.minValue, maxValue: cell.maxValue, targetSd: cell.targetSd, color: cell.color }))
  settings.pairwiseConstraints = ensurePairwiseConstraints(settings, false)
  return settings
}

export function ensurePairwiseConstraints(settings: GeneratorSettings, defaultEnabled = true) {
  const existing = new Map(settings.pairwiseConstraints.map((constraint) => [pairwiseId(constraint.leftGroupId, constraint.rightGroupId), constraint]))
  const next: PairwiseConstraint[] = []
  for (let left = 0; left < settings.groups.length; left += 1) for (let right = left + 1; right < settings.groups.length; right += 1) {
    const first = settings.groups[left]
    const second = settings.groups[right]
    const id = pairwiseId(first.id, second.id)
    next.push(existing.get(id) ?? { id, leftGroupId: first.id, rightGroupId: second.id, enabled: defaultEnabled, pMin: 0.01, pMax: 0.05 })
  }
  return next
}

export const defaultSettings: GeneratorSettings = {
  projectName: '分组约束随机模拟', analysisDesign: 'single', method: 'welch', tail: 'two-sided',
  groups: [
    { id: 'group-1', name: 'Control', n: 8, meanOffset: 0, targetMean: 10, minValue: 0, maxValue: null, targetSd: 1.2, color: colors[0] },
    { id: 'group-2', name: 'Treatment', n: 8, meanOffset: 1.5, targetMean: 11.5, minValue: 0, maxValue: null, targetSd: 1.2, color: colors[1] },
  ],
  pairwiseConstraints: [{ id: 'group-1::group-2', leftGroupId: 'group-1', rightGroupId: 'group-2', enabled: true, pMin: 0.01, pMax: 0.05 }],
  trend: 'custom', baselineMean: 10, effectMin: 0.5, effectMax: 3, targetPMin: 0.01, targetPMax: 0.05,
  dataType: 'decimal', decimals: 2, distribution: 'normal', irregularity: 0.18, seedMode: 'random', seed: '20260819', maxAttempts: 50000, batchN: 8, batchMinValue: 0, batchMaxValue: null, batchTargetSd: 1.2,
  twoWay: { factorA: { name: '因素 A', levels: ['水平 A1', '水平 A2'] }, factorB: { name: '因素 B', levels: ['水平 B1', '水平 B2', '水平 B3'] }, cells: [0, 1].flatMap((factorAIndex) => [0, 1, 2].map((factorBIndex) => ({ id: `cell-${factorAIndex}-${factorBIndex}`, factorAIndex, factorBIndex, n: 8, targetMean: 10 + factorAIndex + factorBIndex, minValue: 0, maxValue: null, targetSd: 1.2, color: colors[factorAIndex * 3 + factorBIndex] }))) },
}

function effectiveMethod(settings: GeneratorSettings) { return settings.groups.length >= 3 ? 'anova' as const : settings.method === 'anova' ? 'welch' as const : settings.method }
function resolution(settings: GeneratorSettings) { return settings.dataType === 'integer' ? 1 : settings.decimals === null ? Number.EPSILON : 1 / (10 ** settings.decimals) }
function displayPrecision(settings: GeneratorSettings) { return settings.decimals === null ? 6 : Math.max(2, settings.decimals) }
function drawDeviation(rng: PRNG, settings: GeneratorSettings, sd: number) {
  const z = normal(rng)
  if (settings.distribution === 'normal') return z * sd
  if (settings.distribution === 'lognormal') return z
  const direction = rng.quick() < 0.5 ? -1 : 1
  return sd * (0.82 * z + settings.irregularity * 0.18 * direction * (z * z - 1))
}
function drawLognormal(rng: PRNG, meanTarget: number, sd: number) {
  const safeMean = Math.max(meanTarget, Number.EPSILON)
  const varianceRatio = (sd / safeMean) ** 2
  const sigma = Math.sqrt(Math.log1p(varianceRatio))
  const mu = Math.log(safeMean) - (sigma ** 2) / 2
  return Math.exp(mu + sigma * normal(rng))
}
function buildOffsets(settings: GeneratorSettings) { return settings.groups.map((group) => group.targetMean - settings.groups[0].targetMean) }
function trendPass(settings: GeneratorSettings, summaries: ReturnType<typeof summarize>[]) {
  const means = summaries.map((summary) => summary.mean)
  if (settings.trend === 'custom') return true
  if (settings.trend === 'ascending') return means.every((value, index) => index === 0 || value > means[index - 1])
  if (settings.trend === 'descending') return means.every((value, index) => index === 0 || value < means[index - 1])
  const typicalSd = settings.groups.reduce((sum, group) => sum + group.targetSd, 0) / settings.groups.length
  return Math.max(...means) - Math.min(...means) <= Math.max(typicalSd, resolution(settings) * 2)
}

function pairwisePValues(settings: GeneratorSettings, values: number[][], test: Candidate['test']) {
  if (test.method !== 'anova') return [{ leftGroupId: settings.groups[0].id, rightGroupId: settings.groups[1].id, pValue: test.pValue, adjustedPValue: test.pValue }]
  return (test.pairwise ?? []).map((pair) => ({ leftGroupId: pair.leftGroupId, rightGroupId: pair.rightGroupId, pValue: pair.pValue, adjustedPValue: pair.adjustedPValue }))
}

function makeCandidate(settings: GeneratorSettings, masterSeed: string, attempt: number): Candidate | null {
  const seed = `${masterSeed}:${attempt}`
  const rng = scopedRng(seed, 'candidate')
  const method = effectiveMethod(settings)
  const offsets = buildOffsets(settings)
  const groupValues: number[][] = []
  for (let groupIndex = 0; groupIndex < settings.groups.length; groupIndex += 1) {
    const group = settings.groups[groupIndex]
    const meanTarget = group.targetMean
    const values: number[] = []
    if (method === 'paired' && groupIndex === 1) {
      const first = groupValues[0]
      const difference = meanTarget - settings.groups[0].targetMean
      if (settings.distribution === 'lognormal') {
        const ratio = meanTarget / Math.max(settings.groups[0].targetMean, Number.EPSILON)
        const sigma = Math.sqrt(Math.log1p((group.targetSd / Math.max(meanTarget, Number.EPSILON)) ** 2))
        for (const value of first) values.push(formatValue(Math.max(Number.EPSILON, value * ratio * Math.exp(sigma * normal(rng))), settings.dataType, settings.decimals))
      } else for (const value of first) values.push(formatValue(value + difference + drawDeviation(rng, settings, group.targetSd), settings.dataType, settings.decimals))
    } else for (let index = 0; index < group.n; index += 1) {
      const rawValue = settings.distribution === 'lognormal' ? drawLognormal(rng, meanTarget, group.targetSd) : meanTarget + drawDeviation(rng, settings, group.targetSd)
      values.push(formatValue(rawValue, settings.dataType, settings.decimals))
    }
    groupValues.push(values)
  }
  if (!groupValues.flat().every((value) => Number.isFinite(value))) return null
  const summaries = settings.groups.map((group, index) => summarize(group.id, group.name, groupValues[index]))
  let test: Candidate['test']
  try {
    test = settings.analysisDesign === 'twoWay'
      ? runTwoWayAnova(settings.groups.map((group, index) => ({ factorAIndex: settings.twoWay!.cells[index].factorAIndex, factorBIndex: settings.twoWay!.cells[index].factorBIndex, values: groupValues[index] })), settings.twoWay!.factorA.name, settings.twoWay!.factorA.levels, settings.twoWay!.factorB.name, settings.twoWay!.factorB.levels)
      : method === 'anova'
        ? runOneWayAnova(settings.groups.map((group, index) => ({ id: group.id, name: group.name, values: groupValues[index] })))
        : runTTest(groupValues[0], groupValues[1], method, settings.tail)
  } catch { return null }
  if (settings.analysisDesign === 'twoWay') test.pairwise = runPairwiseWelch(settings.groups.map((group, index) => ({ id: group.id, name: group.name, values: groupValues[index] })))
  if (!Number.isFinite(test.pValue)) return null
  const pairwise = pairwisePValues(settings, groupValues, test)
  const constraints = ensurePairwiseConstraints(settings, settings.analysisDesign !== 'twoWay')
  const pairChecks: ConstraintCheck[] = constraints.map((constraint) => {
    const observed = pairwise.find((pair) => pair.leftGroupId === constraint.leftGroupId && pair.rightGroupId === constraint.rightGroupId)
    if (constraint.enabled === false) {
      const left = settings.groups.find((group) => group.id === constraint.leftGroupId)?.name ?? constraint.leftGroupId
      const right = settings.groups.find((group) => group.id === constraint.rightGroupId)?.name ?? constraint.rightGroupId
      return { label: `${left} vs ${right} p`, status: 'WARN', detail: observed ? `实际 ${observed.adjustedPValue.toPrecision(5)}；未勾选，不作为生成约束` : '未勾选，不作为生成约束' }
    }
    const pass = observed ? observed.adjustedPValue >= constraint.pMin && observed.adjustedPValue <= constraint.pMax : false
    const left = settings.groups.find((group) => group.id === constraint.leftGroupId)?.name ?? constraint.leftGroupId
    const right = settings.groups.find((group) => group.id === constraint.rightGroupId)?.name ?? constraint.rightGroupId
    return { label: `${left} vs ${right} p`, status: pass ? 'PASS' : 'FAIL', detail: observed ? `实际 ${observed.adjustedPValue.toPrecision(5)}；目标 ${constraint.pMin}–${constraint.pMax}${test.method === 'anova' ? '（BH-FDR）' : ''}` : '找不到对应比较' }
  })
  const rangeChecks: ConstraintCheck[] = settings.groups.map((group, index) => {
    const values = groupValues[index]
    const pass = values.every((value) => value >= group.minValue && (group.maxValue === null || value <= group.maxValue))
    return { label: `${group.name} 范围`, status: pass ? 'PASS' : 'FAIL', detail: `${group.minValue}–${group.maxValue === null ? '无上限' : group.maxValue}` }
  })
  const meanChecks: ConstraintCheck[] = settings.groups.map((group, index) => {
    const expected = group.targetMean
    const tolerance = Math.max(group.targetSd * 0.75, resolution(settings) * 2)
    const pass = Math.abs(summaries[index].mean - expected) <= tolerance
    return { label: `${group.name} 均值`, status: pass ? 'PASS' : 'FAIL', detail: `实际 ${summaries[index].mean.toFixed(displayPrecision(settings))}；目标 ${expected.toFixed(displayPrecision(settings))} ± ${tolerance.toFixed(displayPrecision(settings))}` }
  })
  const sdChecks: ConstraintCheck[] = settings.groups.map((group, index) => {
    const observed = summaries[index].sd
    const pass = observed >= group.targetSd * 0.35 && observed <= group.targetSd * 1.65
    return { label: `${group.name} 离散度`, status: pass ? 'PASS' : 'FAIL', detail: `SD ${observed.toFixed(3)}；目标约 ${group.targetSd.toFixed(3)}` }
  })
  const checks: ConstraintCheck[] = [...pairChecks, ...meanChecks, ...rangeChecks, ...sdChecks, { label: '组间趋势', status: trendPass(settings, summaries) ? 'PASS' : 'FAIL', detail: summaries.map((summary) => `${summary.name}=${summary.mean.toFixed(displayPrecision(settings))}`).join('；') }, { label: '数值格式', status: 'PASS', detail: settings.dataType === 'integer' ? '全部为整数' : settings.decimals === null ? '小数位数不作要求' : `保留最多 ${settings.decimals} 位小数` }]
  const failCount = checks.filter((check) => check.status === 'FAIL').length
  const score = failCount * 100 + constraints.reduce((sum, constraint) => {
    if (constraint.enabled === false) return sum
    const observed = pairwise.find((pair) => pair.leftGroupId === constraint.leftGroupId && pair.rightGroupId === constraint.rightGroupId)?.adjustedPValue ?? 1
    return sum + Math.abs(observed - (constraint.pMin + constraint.pMax) / 2) / Math.max(constraint.pMax - constraint.pMin, 0.000001)
  }, 0)
  return { id: `candidate-${attempt}`, seed, values: groupValues, summaries, test, checks, status: failCount === 0 ? 'PASS' : 'FAIL', score, attempts: attempt, generatedAt: new Date().toISOString() }
}

export function validateSettings(settings: GeneratorSettings) {
  const issues: string[] = []
  if (settings.analysisDesign === 'twoWay') {
    if (!settings.twoWay) issues.push('双因素 ANOVA 缺少因素设置')
    else {
      const cells = settings.twoWay.cells
      if (settings.twoWay.factorA.levels.length < 2 || settings.twoWay.factorB.levels.length < 2) issues.push('双因素 ANOVA 的两个因素都至少需要 2 个水平')
      if (cells.length !== settings.twoWay.factorA.levels.length * settings.twoWay.factorB.levels.length) issues.push('双因素 ANOVA 的数据单元格不完整')
      if (cells.some((cell) => cell.n < 2)) issues.push('双因素 ANOVA 每个单元格至少需要 2 个样本')
      if (new Set(cells.map((cell) => cell.n)).size > 1) issues.push('当前本地预览要求双因素 ANOVA 每个单元格的 n 相同')
    }
  }
  if (settings.groups.length < 2) issues.push('至少需要 2 个组')
  if (settings.groups.some((group) => group.n < 2)) issues.push('每组至少需要 2 个样本')
  if (settings.groups.some((group) => group.maxValue !== null && group.minValue >= group.maxValue)) issues.push('每组的最小值必须小于最大值')
  if (settings.groups.some((group) => group.targetSd <= 0)) issues.push('每组目标离散度 SD 必须大于 0')
  if (settings.groups.length > 2 && settings.method === 'paired') issues.push('三组及以上不能使用配对 t-test，系统将使用 one-way ANOVA')
  if (settings.groups.length === 2 && settings.method === 'anova') issues.push('只有两组时请使用 t-test；三组及以上自动使用 one-way ANOVA')
  if (settings.method === 'paired' && settings.groups.length === 2 && settings.groups[0].n !== settings.groups[1].n) issues.push('配对 t-test 要求两组样本量相同')
  const constraints = ensurePairwiseConstraints(settings, settings.analysisDesign !== 'twoWay')
  if (constraints.some((constraint) => constraint.enabled !== false && !(constraint.pMin >= 0 && constraint.pMax <= 1 && constraint.pMin < constraint.pMax))) issues.push('已勾选组对的 p 值范围必须满足 0 ≤ 最小值 < 最大值 ≤ 1')
  if (settings.dataType === 'integer' && settings.groups.some((group) => group.maxValue !== null && group.maxValue - group.minValue < 2)) issues.push('整数范围过窄，至少应包含 3 个可能值')
  if (settings.distribution === 'lognormal' && settings.groups.some((group) => group.targetMean <= 0 || group.minValue < 0)) issues.push('对数正态分布要求目标均值大于 0，且最小值不能小于 0')
  return issues
}

export function generateCandidates(settings: GeneratorSettings, candidateCount = 3): GenerationReport {
  const prepared = syncTwoWayGroups({ ...settings, twoWay: settings.twoWay ? JSON.parse(JSON.stringify(settings.twoWay)) : undefined })
  const issues = validateSettings(prepared)
  if (issues.length) throw new Error(issues.join('；'))
  const normalized = { ...prepared, pairwiseConstraints: ensurePairwiseConstraints(prepared, prepared.analysisDesign !== 'twoWay') }
  const startedAt = new Date().toISOString(); const masterSeed = settings.seedMode === 'locked' ? settings.seed : createRandomSeed(); const accepted: Candidate[] = []; const nearest: Candidate[] = []; let attempts = 0
  for (let attempt = 1; attempt <= settings.maxAttempts && accepted.length < candidateCount; attempt += 1) { attempts = attempt; const candidate = makeCandidate(normalized, masterSeed, attempt); if (!candidate) continue; if (candidate.status === 'PASS') accepted.push(candidate); else { nearest.push(candidate); nearest.sort((left, right) => left.score - right.score); if (nearest.length > 3) nearest.pop() } }
  const enabledCount = normalized.pairwiseConstraints.filter((constraint) => constraint.enabled !== false).length
  return { settings: { ...normalized, seed: masterSeed, method: effectiveMethod(normalized) }, candidates: accepted.length ? accepted : nearest.slice(0, 1), selectedIndex: 0, attempts, startedAt, completedAt: new Date().toISOString(), message: accepted.length ? `找到 ${accepted.length} 套满足已勾选 ${enabledCount} 个组对约束的独立随机候选数据。` : `在 ${attempts} 次完整随机抽样中未找到满足已勾选组对约束的候选，显示最接近候选。` }
}

export function cloneSettings(settings: GeneratorSettings): GeneratorSettings { return JSON.parse(JSON.stringify(settings)) as GeneratorSettings }
