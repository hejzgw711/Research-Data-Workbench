import type { PRNG } from 'seedrandom'
import { jStat } from 'jstat'
import type {
  AnovaEffectResult,
  TimePointConfig,
  TimeSeriesCandidate,
  TimeSeriesCellConfig,
  TimeSeriesCellSummary,
  TimeSeriesGenerationReport,
  TimeSeriesGeneratorSettings,
  TimeSeriesPairwiseResult,
  TimeSeriesSettings,
  TimeSeriesTestResult,
} from '../models'
import { createRandomSeed, formatValue, normal, scopedRng } from './random'
import { mean, runTTest, significanceLabel, summarize } from './statistics'

/** Return a stable id for the cell at group g and time t. */
export function timeSeriesCellId(groupIndex: number, timeIndex: number) {
  return `ts-cell-${groupIndex}-${timeIndex}`
}

/**
 * Keep the rectangular group x time cell matrix in sync after a group or time
 * point is added/removed. Existing cell constraints are preserved by id.
 */
export function syncTimeSeriesCells<T extends TimeSeriesSettings>(settings: T): T {
  const existing = new Map(settings.cells.map((cell) => [cell.id, cell]))
  const cells: TimeSeriesCellConfig[] = []
  settings.groups.forEach((_, groupIndex) => settings.timePoints.forEach((_, timeIndex) => {
    const id = timeSeriesCellId(groupIndex, timeIndex)
    const previous = existing.get(id)
    cells.push(previous ?? {
      id,
      groupIndex,
      timeIndex,
      targetMean: 10 + groupIndex + timeIndex,
      targetSd: 1.2,
      minValue: 0,
      maxValue: null,
    })
  }))
  settings.cells = cells
  return settings
}

export const defaultTimeSeriesSettings: TimeSeriesGeneratorSettings = {
  design: 'repeatedTwoWay',
  groups: [
    { id: 'ts-group-1', name: 'Control', n: 8, color: '#78b7b0' },
    { id: 'ts-group-2', name: 'Treatment', n: 8, color: '#e7ad97' },
  ],
  timePoints: [
    { id: 'ts-time-0', value: 0, label: 'Day 0' },
    { id: 'ts-time-1', value: 1, label: 'Day 1' },
    { id: 'ts-time-3', value: 3, label: 'Day 3' },
    { id: 'ts-time-7', value: 7, label: 'Day 7' },
  ],
  cells: [],
  errorBar: 'sd',
  xAxisTitle: 'Time (days)',
  yAxisTitle: 'Value',
  chartTitle: 'Longitudinal behavioural outcome',
  dataType: 'decimal',
  decimals: 2,
  distribution: 'normal',
  irregularity: 0.18,
  seedMode: 'random',
  seed: '20260827-time-series',
  maxAttempts: 1,
  batchTargetMean: 10,
  batchMinValue: 0,
  batchMaxValue: null,
  batchTargetSd: 1.2,
}
syncTimeSeriesCells(defaultTimeSeriesSettings)

function pFromF(statistic: number, df1: number, df2: number) {
  if (statistic === Infinity) return 0
  if (statistic <= 0) return 1
  if (!Number.isFinite(statistic) || df1 <= 0 || df2 <= 0) return Number.NaN
  return 1 - jStat.centralF.cdf(statistic, df1, df2)
}

function effectResult(name: string, ss: number, df: number, denominatorSs: number, msError: number, denominatorDf: number): AnovaEffectResult {
  const ms = ss / df
  const statistic = msError <= 0 ? (ms <= 0 ? 0 : Infinity) : ms / msError
  return {
    name,
    degreesOfFreedom: df,
    sumOfSquares: ss,
    meanSquare: ms,
    statistic,
    pValue: pFromF(statistic, df, denominatorDf),
    effectSize: ss / Math.max(ss + denominatorSs, Number.EPSILON),
  }
}

function checkRectangularValues(values: number[][][]) {
  const groups = values.length
  const times = values[0]?.length ?? 0
  const subjects = values[0]?.[0]?.length ?? 0
  if (groups < 2 || times < 2 || subjects < 2) throw new Error('重复测量 two-way ANOVA 至少需要 2 组、2 个时间点和每组 2 个动物')
  if (values.some((group) => group.length !== times || group.some((cell) => cell.length !== subjects))) throw new Error('重复测量数据必须是完整、平衡的 组 × 时间点 × 动物矩阵')
  if (values.flat(2).some((value) => !Number.isFinite(value))) throw new Error('重复测量数据包含非有限数值')
  return { groups, times, subjects }
}

/**
 * Ordinary mixed/repeated-measures two-way ANOVA for a balanced design.
 * The first factor is between-subject (group), the second is within-subject
 * (time). Subjects are indexed within group and are measured at every time.
 */
export function runRepeatedMeasuresTwoWayAnova(
  values: number[][][],
  groupName = 'Group',
  timeName = 'Time',
  groupLabels = values.map((_, index) => `Group ${index + 1}`),
  timeLabels = values[0]?.map((_, index) => `Time ${index + 1}`) ?? [],
): TimeSeriesTestResult {
  const { groups: groupCount, times: timeCount, subjects } = checkRectangularValues(values)
  const all = values.flat(2)
  const grandMean = mean(all)
  const groupMeans = values.map((group) => mean(group.flat()))
  const timeMeans = Array.from({ length: timeCount }, (_, timeIndex) => mean(values.flatMap((group) => group[timeIndex])))
  const cellMeans = values.map((group) => group.map((cell) => mean(cell)))
  const subjectMeans = values.map((group) => Array.from({ length: subjects }, (_, subjectIndex) => mean(group.map((cell) => cell[subjectIndex]))))

  const ssGroup = timeCount * subjects * groupMeans.reduce((sum, value) => sum + (value - grandMean) ** 2, 0)
  const ssSubject = timeCount * subjectMeans.reduce((sum, row, groupIndex) => sum + row.reduce((inner, value) => inner + (value - groupMeans[groupIndex]) ** 2, 0), 0)
  const ssTime = groupCount * subjects * timeMeans.reduce((sum, value) => sum + (value - grandMean) ** 2, 0)
  const ssInteraction = subjects * cellMeans.reduce((sum, row, groupIndex) => sum + row.reduce((inner, value, timeIndex) => inner + (value - groupMeans[groupIndex] - timeMeans[timeIndex] + grandMean) ** 2, 0), 0)
  const ssError = values.reduce((sum, group, groupIndex) => sum + group.reduce((rowSum, cell, timeIndex) => rowSum + cell.reduce((cellSum, value, subjectIndex) => cellSum + (value - subjectMeans[groupIndex][subjectIndex] - cellMeans[groupIndex][timeIndex] + groupMeans[groupIndex]) ** 2, 0), 0), 0)
  const ssTotal = all.reduce((sum, value) => sum + (value - grandMean) ** 2, 0)

  const dfGroup = groupCount - 1
  const dfSubject = groupCount * (subjects - 1)
  const dfTime = timeCount - 1
  const dfInteraction = dfGroup * dfTime
  const dfError = groupCount * (subjects - 1) * (timeCount - 1)
  const group = effectResult(groupName, ssGroup, dfGroup, ssSubject, ssSubject / dfSubject, dfSubject)
  const time = effectResult(timeName, ssTime, dfTime, ssError, ssError / dfError, dfError)
  const interaction = effectResult(`${groupName} × ${timeName}`, ssInteraction, dfInteraction, ssError, ssError / dfError, dfError)

  const pairwise = runTimePointPairwise(values, groupLabels, timeLabels)
  const twoWay = {
    group,
    time,
    interaction,
    subjectResidualDegreesOfFreedom: dfSubject,
    residualDegreesOfFreedom: dfError,
    totalDegreesOfFreedom: all.length - 1,
    subjectsPerGroup: subjects,
    timePoints: timeCount,
  }
  return {
    method: 'repeated-two-way',
    design: 'repeated-two-way',
    statistic: interaction.statistic,
    degreesOfFreedom: dfError,
    pValue: interaction.pValue,
    effectSize: interaction.effectSize,
    twoWay,
    pairwise,
  }
}

// Short aliases make the API easier to discover from the UI layer.
export const runTimeSeriesAnova = runRepeatedMeasuresTwoWayAnova
export const runRepeatedMeasuresTwoWay = runRepeatedMeasuresTwoWayAnova

function runTimePointPairwise(values: number[][][], groupLabels: string[], timeLabels: string[]): TimeSeriesPairwiseResult[] {
  const raw: Array<TimeSeriesPairwiseResult & { rawP: number }> = []
  for (let timeIndex = 0; timeIndex < (values[0]?.length ?? 0); timeIndex += 1) {
    for (let left = 0; left < values.length; left += 1) for (let right = left + 1; right < values.length; right += 1) {
      const test = runTTest(values[left][timeIndex], values[right][timeIndex], 'welch', 'two-sided')
      raw.push({ timeIndex, timeLabel: timeLabels[timeIndex] ?? `Time ${timeIndex + 1}`, leftGroupId: String(left), leftGroupName: groupLabels[left] ?? `Group ${left + 1}`, rightGroupId: String(right), rightGroupName: groupLabels[right] ?? `Group ${right + 1}`, statistic: test.statistic, degreesOfFreedom: test.degreesOfFreedom, rawPValue: test.pValue, adjustedPValue: test.pValue, pValue: test.pValue, label: significanceLabel(test.pValue), rawP: test.pValue })
    }
  }
  // Holm adjustment is applied within each time point so the displayed stars
  // do not inflate the family-wise error rate across group pairs.
  const byTime = new Map<number, typeof raw>()
  raw.forEach((pair) => byTime.set(pair.timeIndex, [...(byTime.get(pair.timeIndex) ?? []), pair]))
  byTime.forEach((pairs) => {
    const ordered = [...pairs].sort((a, b) => a.rawP - b.rawP)
    let runningMaximum = 0
    ordered.forEach((pair, index) => {
      runningMaximum = Math.max(runningMaximum, (ordered.length - index) * pair.rawP)
      pair.pValue = Math.min(1, runningMaximum)
      pair.adjustedPValue = pair.pValue
      pair.label = significanceLabel(pair.pValue)
    })
  })
  return raw.map(({ rawP: _rawP, ...pair }) => pair)
}

export function summarizeTimeSeries(values: number[][][], settings: Pick<TimeSeriesSettings, 'groups' | 'timePoints'>): TimeSeriesCellSummary[] {
  checkRectangularValues(values)
  return values.flatMap((groupValues, groupIndex) => groupValues.map((cellValues, timeIndex) => {
    const summary = summarize(settings.groups[groupIndex]?.id ?? String(groupIndex), settings.groups[groupIndex]?.name ?? `Group ${groupIndex + 1}`, cellValues)
    const time = settings.timePoints[timeIndex] ?? { id: String(timeIndex), label: `Time ${timeIndex + 1}`, value: timeIndex }
    return { groupId: summary.groupId, groupName: summary.name, timeId: time.id, timeLabel: time.label, timeValue: time.value, n: summary.n, values: summary.values, mean: summary.mean, sd: summary.sd, sem: summary.sem, ciLow: summary.ciLow, ciHigh: summary.ciHigh }
  }))
}

function drawIrregular(rng: PRNG, sd: number, irregularity: number) {
  const z = normal(rng)
  const direction = rng.quick() < 0.5 ? -1 : 1
  return sd * (0.82 * z + irregularity * 0.18 * direction * (z * z - 1))
}

function drawLognormal(rng: PRNG, targetMean: number, targetSd: number) {
  const safeMean = Math.max(targetMean, Number.EPSILON)
  const sigma = Math.sqrt(Math.log1p((targetSd / safeMean) ** 2))
  const mu = Math.log(safeMean) - sigma ** 2 / 2
  return Math.exp(mu + sigma * normal(rng))
}

function drawCellValue(rng: PRNG, settings: TimeSeriesGeneratorSettings, cell: TimeSeriesCellConfig, subjectEffect: number) {
  const raw = settings.distribution === 'lognormal'
    ? drawLognormal(rng, cell.targetMean, cell.targetSd) * Math.exp(subjectEffect / Math.max(cell.targetMean, Number.EPSILON))
    : cell.targetMean + subjectEffect + (settings.distribution === 'irregular' ? drawIrregular(rng, cell.targetSd * 0.94, settings.irregularity) : normal(rng, 0, cell.targetSd * 0.94))
  const bounded = Math.max(cell.minValue, cell.maxValue === null ? raw : Math.min(cell.maxValue, raw))
  const formatted = formatValue(bounded, settings.dataType, settings.decimals)
  // Rounding can move a value a tiny amount outside a manually entered bound.
  return Math.max(cell.minValue, cell.maxValue === null ? formatted : Math.min(cell.maxValue, formatted))
}

export function validateTimeSeriesSettings(settings: TimeSeriesGeneratorSettings) {
  const issues: string[] = []
  if (settings.groups.length < 2) issues.push('时间序列至少需要 2 个组')
  if (settings.timePoints.length < 2) issues.push('时间序列至少需要 2 个时间点')
  if (settings.timePoints.some((time) => !Number.isFinite(time.value))) issues.push('时间点数值必须是有限数字')
  if (new Set(settings.timePoints.map((time) => time.value)).size !== settings.timePoints.length) issues.push('时间点数值不能重复')
  if (settings.timePoints.some((time) => !time.label.trim())) issues.push('每个时间点都需要填写显示标签')
  if (settings.groups.some((group) => group.n < 2)) issues.push('每组至少需要 2 个动物')
  if (new Set(settings.groups.map((group) => group.n)).size > 1) issues.push('重复测量设计要求每组 n 相同')
  if (settings.cells.length !== settings.groups.length * settings.timePoints.length) issues.push('时间序列数据单元格不完整，请重新同步组和时间点')
  if (settings.cells.some((cell) => !Number.isFinite(cell.targetMean) || !Number.isFinite(cell.targetSd) || !Number.isFinite(cell.minValue) || (cell.maxValue !== null && !Number.isFinite(cell.maxValue)))) issues.push('每个组 × 时间点的均值、SD 和范围都必须是有限数字')
  if (settings.cells.some((cell) => cell.targetSd <= 0)) issues.push('每个组 × 时间点的目标 SD 必须大于 0')
  if (settings.cells.some((cell) => cell.maxValue !== null && cell.minValue >= cell.maxValue)) issues.push('每个组 × 时间点的最小值必须小于最大值')
  if (settings.distribution === 'lognormal' && settings.cells.some((cell) => cell.targetMean <= 0 || cell.minValue < 0)) issues.push('对数正态分布要求目标均值大于 0，且最小值不能小于 0')
  if (settings.cells.some((cell) => cell.groupIndex < 0 || cell.groupIndex >= settings.groups.length || cell.timeIndex < 0 || cell.timeIndex >= settings.timePoints.length)) issues.push('时间序列单元格索引超出范围')
  return issues
}

export function generateTimeSeriesCandidate(settings: TimeSeriesGeneratorSettings, seed = settings.seed): TimeSeriesCandidate {
  const issues = validateTimeSeriesSettings(settings)
  if (issues.length) throw new Error(issues.join('；'))
  const values: number[][][] = settings.groups.map(() => settings.timePoints.map(() => [] as number[]))
  const cellAt = (groupIndex: number, timeIndex: number) => settings.cells.find((cell) => cell.groupIndex === groupIndex && cell.timeIndex === timeIndex)!
  for (let groupIndex = 0; groupIndex < settings.groups.length; groupIndex += 1) {
    const group = settings.groups[groupIndex]
    for (let subjectIndex = 0; subjectIndex < group.n; subjectIndex += 1) {
      // A subject-level effect induces realistic within-animal correlation
      // while leaving each time point's target SD as the dominant variation.
      const subjectEffect = normal(scopedRng(seed, 'subject', groupIndex, subjectIndex), 0, 0.35 * Math.max(...settings.timePoints.map((_, timeIndex) => cellAt(groupIndex, timeIndex).targetSd)))
      settings.timePoints.forEach((_, timeIndex) => {
        const cell = cellAt(groupIndex, timeIndex)
        values[groupIndex][timeIndex].push(drawCellValue(scopedRng(seed, 'cell', groupIndex, timeIndex, subjectIndex), settings, cell, subjectEffect))
      })
    }
  }
  const summaries = summarizeTimeSeries(values, settings)
  const test = runRepeatedMeasuresTwoWayAnova(values, 'Group', 'Time', settings.groups.map((group) => group.name), settings.timePoints.map((time) => time.label))
  return { id: `time-series-candidate-${seed}`, seed, values, summaries, test, generatedAt: new Date().toISOString() }
}

export function generateTimeSeriesCandidates(settings: TimeSeriesGeneratorSettings, candidateCount = 3): TimeSeriesGenerationReport {
  const prepared = syncTimeSeriesCells(JSON.parse(JSON.stringify(settings)) as TimeSeriesGeneratorSettings)
  const issues = validateTimeSeriesSettings(prepared)
  if (issues.length) throw new Error(issues.join('；'))
  const startedAt = new Date().toISOString()
  const masterSeed = prepared.seedMode === 'locked' ? prepared.seed : createRandomSeed()
  const candidates = Array.from({ length: Math.max(1, candidateCount) }, (_, index) => generateTimeSeriesCandidate(prepared, `${masterSeed}:${index + 1}`))
  return { settings: { ...prepared, seed: masterSeed }, candidates, selectedIndex: 0, attempts: candidates.length, startedAt, completedAt: new Date().toISOString(), message: `已生成 ${candidates.length} 套时间序列模拟数据（重复测量 two-way ANOVA）。` }
}
