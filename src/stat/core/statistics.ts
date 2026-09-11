import { jStat } from 'jstat'
import type { PairwiseResult, Summary, Tail, TestMethod, TestResult, TwoWayAnovaResult } from '../models'

export const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN

export function sampleSd(values: number[]) {
  if (values.length < 2) return 0
  const center = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1))
}

export function summarize(groupId: string, name: string, values: number[]): Summary {
  const average = mean(values)
  const sd = sampleSd(values)
  const sem = sd / Math.sqrt(values.length)
  const critical = values.length > 1 ? jStat.studentt.inv(0.975, values.length - 1) : Number.NaN
  return { groupId, name, n: values.length, values, mean: average, sd, sem, ciLow: average - critical * sem, ciHigh: average + critical * sem }
}

function pFromT(statistic: number, degreesOfFreedom: number, tail: Tail) {
  if (!Number.isFinite(statistic) || !Number.isFinite(degreesOfFreedom)) return Number.NaN
  if (tail === 'greater') return 1 - jStat.studentt.cdf(statistic, degreesOfFreedom)
  if (tail === 'less') return jStat.studentt.cdf(statistic, degreesOfFreedom)
  return 2 * (1 - jStat.studentt.cdf(Math.abs(statistic), degreesOfFreedom))
}

export function runTTest(valuesA: number[], valuesB: number[], method: Exclude<TestMethod, 'anova'>, tail: Tail): TestResult {
  const meanA = mean(valuesA)
  const meanB = mean(valuesB)
  const varianceA = sampleSd(valuesA) ** 2
  const varianceB = sampleSd(valuesB) ** 2
  let statistic: number
  let degreesOfFreedom: number
  let effectSize: number

  if (method === 'paired') {
    if (valuesA.length !== valuesB.length) throw new Error('配对 t-test 要求两组样本量相同')
    const differences = valuesB.map((value, index) => value - valuesA[index])
    const differenceSd = sampleSd(differences)
    statistic = differenceSd === 0 ? (mean(differences) === 0 ? 0 : Math.sign(mean(differences)) * Infinity) : mean(differences) / (differenceSd / Math.sqrt(differences.length))
    degreesOfFreedom = differences.length - 1
    effectSize = differenceSd === 0 ? (mean(differences) === 0 ? 0 : Math.sign(mean(differences)) * Infinity) : mean(differences) / differenceSd
  } else if (method === 'student') {
    const pooledVariance = (((valuesA.length - 1) * varianceA) + ((valuesB.length - 1) * varianceB)) / (valuesA.length + valuesB.length - 2)
    const denominator = Math.sqrt(pooledVariance * (1 / valuesA.length + 1 / valuesB.length))
    statistic = denominator === 0 ? (meanB === meanA ? 0 : Math.sign(meanB - meanA) * Infinity) : (meanB - meanA) / denominator
    degreesOfFreedom = valuesA.length + valuesB.length - 2
    effectSize = Math.sqrt(pooledVariance) === 0 ? (meanB === meanA ? 0 : Math.sign(meanB - meanA) * Infinity) : (meanB - meanA) / Math.sqrt(pooledVariance)
  } else {
    const termA = varianceA / valuesA.length
    const termB = varianceB / valuesB.length
    const denominator = Math.sqrt(termA + termB)
    statistic = denominator === 0 ? (meanB === meanA ? 0 : Math.sign(meanB - meanA) * Infinity) : (meanB - meanA) / denominator
    degreesOfFreedom = (termA + termB) ** 2 / ((termA ** 2) / (valuesA.length - 1) + (termB ** 2) / (valuesB.length - 1))
    const pooledSd = Math.sqrt(((valuesA.length - 1) * varianceA + (valuesB.length - 1) * varianceB) / (valuesA.length + valuesB.length - 2))
    effectSize = pooledSd === 0 ? (meanB === meanA ? 0 : Math.sign(meanB - meanA) * Infinity) : (meanB - meanA) / pooledSd
  }
  const pValue = Number.isFinite(statistic) ? pFromT(statistic, degreesOfFreedom, tail) : (statistic === 0 ? 1 : 0)
  return { method, tail, statistic, degreesOfFreedom, pValue, effectSize }
}

export function significanceLabel(pValue: number) {
  if (pValue < 0.0001) return '****'
  if (pValue < 0.001) return '***'
  if (pValue < 0.01) return '**'
  if (pValue < 0.05) return '*'
  return 'ns'
}

export function runOneWayAnova(groups: Array<{ id: string; name: string; values: number[] }>): TestResult {
  const valid = groups.filter((group) => group.values.length >= 2)
  if (valid.length < 3) throw new Error('one-way ANOVA 至少需要 3 个有重复数据的组')
  const allValues = valid.flatMap((group) => group.values)
  const grandMean = mean(allValues)
  const ssBetween = valid.reduce((sum, group) => sum + group.values.length * (mean(group.values) - grandMean) ** 2, 0)
  const ssWithin = valid.reduce((sum, group) => sum + group.values.reduce((inner, value) => inner + (value - mean(group.values)) ** 2, 0), 0)
  const dfBetween = valid.length - 1
  const dfWithin = allValues.length - valid.length
  const msBetween = ssBetween / dfBetween
  const msWithin = ssWithin / dfWithin
  const statistic = msWithin === 0 ? (msBetween === 0 ? 0 : Infinity) : msBetween / msWithin
  const pValue = statistic === Infinity ? 0 : statistic === 0 ? 1 : 1 - jStat.centralF.cdf(statistic, dfBetween, dfWithin)
  const ssTotal = ssBetween + ssWithin
  return { method: 'anova', tail: 'two-sided', statistic, degreesOfFreedom: dfWithin, effectSize: ssTotal === 0 ? 0 : ssBetween / ssTotal, pValue, dfBetween, dfWithin, pairwise: runPairwiseWelch(groups) }
}

export function runTwoWayAnova(
  cells: Array<{ factorAIndex: number; factorBIndex: number; values: number[] }>,
  factorAName: string,
  factorALevels: string[],
  factorBName: string,
  factorBLevels: string[],
): TestResult {
  const expectedCellCount = factorALevels.length * factorBLevels.length
  if (factorALevels.length < 2 || factorBLevels.length < 2) throw new Error('双因素 ANOVA 的两个因素都至少需要 2 个水平')
  if (cells.length !== expectedCellCount) throw new Error('双因素 ANOVA 的数据单元格不完整')
  const replicates = cells[0]?.values.length ?? 0
  if (replicates < 2 || cells.some((cell) => cell.values.length !== replicates)) throw new Error('双因素 ANOVA 当前预览要求每个单元格的重复数相同，且至少为 2')
  const cellAt = (a: number, b: number) => cells.find((cell) => cell.factorAIndex === a && cell.factorBIndex === b)!
  const allValues = cells.flatMap((cell) => cell.values)
  const grandMean = mean(allValues)
  const cellMeans = factorALevels.map((_, a) => factorBLevels.map((_, b) => mean(cellAt(a, b).values)))
  const factorAMeans = factorALevels.map((_, a) => mean(factorBLevels.flatMap((_, b) => cellAt(a, b).values)))
  const factorBMeans = factorBLevels.map((_, b) => mean(factorALevels.flatMap((_, a) => cellAt(a, b).values)))
  const sumSquares = (values: number[]) => values.reduce((sum, value) => sum + value ** 2, 0)
  const ssA = factorBLevels.length * replicates * sumSquares(factorAMeans.map((value) => value - grandMean))
  const ssB = factorALevels.length * replicates * sumSquares(factorBMeans.map((value) => value - grandMean))
  const ssInteraction = replicates * cellMeans.reduce((sum, row, a) => sum + row.reduce((rowSum, value, b) => rowSum + (value - factorAMeans[a] - factorBMeans[b] + grandMean) ** 2, 0), 0)
  const ssError = cells.reduce((sum, cell) => { const center = mean(cell.values); return sum + cell.values.reduce((cellSum, value) => cellSum + (value - center) ** 2, 0) }, 0)
  const dfA = factorALevels.length - 1
  const dfB = factorBLevels.length - 1
  const dfInteraction = dfA * dfB
  const dfError = expectedCellCount * (replicates - 1)
  const msError = ssError / dfError
  const effect = (name: string, ss: number, df: number) => {
    const ms = ss / df
    const statistic = msError === 0 ? (ms === 0 ? 0 : Infinity) : ms / msError
    const pValue = statistic === Infinity ? 0 : statistic === 0 ? 1 : 1 - jStat.centralF.cdf(statistic, df, dfError)
    return { name, degreesOfFreedom: df, sumOfSquares: ss, meanSquare: ms, statistic, pValue, effectSize: ss / Math.max(ss + ssError, Number.EPSILON) }
  }
  const twoWay: TwoWayAnovaResult = {
    factorA: effect(factorAName, ssA, dfA),
    factorB: effect(factorBName, ssB, dfB),
    interaction: effect(`${factorAName} × ${factorBName}`, ssInteraction, dfInteraction),
    residualDegreesOfFreedom: dfError,
    totalDegreesOfFreedom: allValues.length - 1,
    replicatesPerCell: replicates,
  }
  return { method: 'anova', tail: 'two-sided', design: 'two-way', statistic: twoWay.interaction.statistic, degreesOfFreedom: dfError, pValue: twoWay.interaction.pValue, effectSize: twoWay.interaction.effectSize, dfBetween: dfInteraction, dfWithin: dfError, twoWay }
}

export function runPairwiseWelch(groups: Array<{ id: string; name: string; values: number[] }>): PairwiseResult[] {
  const raw: Array<PairwiseResult & { rawP: number }> = []
  for (let left = 0; left < groups.length; left += 1) for (let right = left + 1; right < groups.length; right += 1) {
    const test = runTTest(groups[left].values, groups[right].values, 'welch', 'two-sided')
    raw.push({ leftGroupId: groups[left].id, leftGroupName: groups[left].name, rightGroupId: groups[right].id, rightGroupName: groups[right].name, statistic: test.statistic, degreesOfFreedom: test.degreesOfFreedom, pValue: test.pValue, adjustedPValue: test.pValue, label: significanceLabel(test.pValue), rawP: test.pValue })
  }
  const ordered = [...raw].sort((left, right) => left.rawP - right.rawP)
  let runningMinimum = 1
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    runningMinimum = Math.min(runningMinimum, (ordered[index].rawP * ordered.length) / (index + 1))
    ordered[index].adjustedPValue = Math.min(1, runningMinimum)
    ordered[index].label = significanceLabel(ordered[index].adjustedPValue)
  }
  return raw.map(({ rawP: _rawP, ...result }) => result)
}
