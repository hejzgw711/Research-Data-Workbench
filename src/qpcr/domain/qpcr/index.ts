import { jStat } from 'jstat'
import type { ComparisonResult, CurvePoint, GeneConfig, GroupAnalysis, QCResult, QPCRProject, SampleAnalysis, SimulationResult, Well, WellValues } from '../../models'

export const MAX_WELLS = 9600

/** Undefined sample summaries stay NaN; presentation code displays an em dash. */
export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN
}

export function sampleSD(values: number[]): number {
  if (values.length < 2) return NaN
  const center = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1))
}

export function geometricMean(values: number[]): number {
  return values.length && values.every(value => Number.isFinite(value) && value > 0)
    ? Math.exp(mean(values.map(Math.log))) : NaN
}

/** FNV-1a keyed substream followed by one Mulberry32 draw; no mutable shared stream. */
export function randomFor(seed: number, key: string): number {
  let hash = (2166136261 ^ (seed >>> 0)) >>> 0
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0
  let value = (hash + 0x6D2B79F5) >>> 0
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return (((value ^ (value >>> 14)) >>> 0) + 0.5) / 4294967296
}

export function normalFor(seed: number, key: string): number {
  return Math.sqrt(-2 * Math.log(randomFor(seed, `${key}/u1`))) * Math.cos(2 * Math.PI * randomFor(seed, `${key}/u2`))
}

export function significance(p: number | null): string {
  if (p === null || !Number.isFinite(p) || p < 0 || p > 1) return '—'
  return p < 0.0001 ? '****' : p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : 'ns'
}

export interface WelchResult {
  p: number | null; statistic: number | null; df: number | null;
  status: 'ok' | 'not_applicable'; reason?: string
}

export function welchTest(a: number[], b: number[]): WelchResult {
  const unavailable = (reason: string): WelchResult => ({ p: null, statistic: null, df: null, status: 'not_applicable', reason })
  if (a.length < 2 || b.length < 2) return unavailable('每组至少需要 2 个独立观测值。')
  if (![...a, ...b].every(Number.isFinite)) return unavailable('观测值含缺失或非有限数值。')
  const va = sampleSD(a) ** 2 / a.length
  const vb = sampleSD(b) ** 2 / b.length
  const variance = va + vb
  if (!(variance > 0) || !Number.isFinite(variance)) return unavailable('两组方差均为零或数值无效，无法估计 Welch 检验。')
  const statistic = (mean(a) - mean(b)) / Math.sqrt(variance)
  const df = variance ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1))
  // Evaluate the lower tail directly, avoiding 1 - CDF cancellation for small p.
  const p = Math.min(1, Math.max(0, 2 * jStat.studentt.cdf(-Math.abs(statistic), df)))
  if (!Number.isFinite(p) || !Number.isFinite(df)) return unavailable('数值计算未得到有效 p 值。')
  return { p, statistic, df, status: 'ok' }
}

/** Holm family is the configured, valid pairwise tests for one target gene. */
export function holmAdjust(values: Array<number | null>): Array<number | null> {
  const ordered = values.map((p, index) => ({ p, index })).filter((entry): entry is { p: number; index: number } => entry.p !== null && Number.isFinite(entry.p)).sort((a, b) => a.p - b.p)
  const adjusted: Array<number | null> = values.map(() => null)
  let previous = 0
  ordered.forEach(({ p, index }, rank) => {
    previous = Math.min(1, Math.max(previous, p * (ordered.length - rank)))
    adjusted[index] = previous
  })
  return adjusted
}

const isPositiveInteger = (value: number) => Number.isInteger(value) && value > 0
const finite = (value: number) => Number.isFinite(value)
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function validatePlateWells(wells: Well[]): QCResult[] {
  const issues: QCResult[] = []
  const occupied = new Set<string>()
  const keys = new Set<string>()
  for (const well of wells) {
    const location = `${well.plateIndex}/${well.wellId}`
    if (!Number.isInteger(well.plateIndex) || well.plateIndex < 0 || !/^[A-H](?:[1-9]|1[0-2])$/.test(well.wellId)
      || well.wellId !== `${well.row}${well.column}` || occupied.has(location) || keys.has(well.key)) {
      issues.push({ id: `plate/${well.key}`, level: 'fail', message: '孔位无效或分配冲突。', wellIds: [well.id] })
    }
    occupied.add(location)
    keys.add(well.key)
  }
  return issues
}

function generatedValues(project: QPCRProject, groupId: string, bio: number, gene: GeneConfig, tech: number): WellValues {
  const group = project.groups.find(item => item.id === groupId)!
  const seed = project.randomSeed
  const rowRevision = project.rowSeeds[`${groupId}/${gene.id}`] ?? 0
  const key = `${groupId}/${bio}/${gene.id}/${tech}/row-${rowRevision}`
  const draw = (metric: string) => normalFor(seed, `${key}/${metric}`)
  const noiseScale = { low: 0.5, medium: 1, high: 1.75 }[project.simulation.noiseLevel] * (project.simulation.preset === 'precision' ? 0.25 : 1)
  const ref = project.genes.find(item => item.type === 'reference')
  const refDrift = normalFor(seed, `${groupId}/${bio}/reference-drift`) * project.simulation.referenceCqSD * noiseScale
  let cq = gene.nominalCq + refDrift
  if (gene.type === 'target') {
    const config = group.targetFoldByGene[gene.id] ?? { mean: 1, sd: 0.15, sdMode: 'auto' }
    const foldMean = group.isCalibrator ? 1 : config.mean
    const autoCV = { low: 0.08, medium: 0.15, high: 0.3 }[project.simulation.noiseLevel]
    const foldSD = config.sdMode === 'auto' ? foldMean * autoCV : config.sd
    const sigma = Math.sqrt(Math.log1p((foldSD / foldMean) ** 2))
    const logCenter = Math.log(foldMean) - sigma ** 2 / 2
    // Biological expression is shared across technical wells. Technical-only mode
    // supplies paired demonstration values, explicitly never independent biological n.
    const expressionKey = `${groupId}/${bio}/${gene.id}/expression/${project.replicateMode === 'technical' ? tech : 'bio'}/row-${rowRevision}`
    const logFold = logCenter + sigma * normalFor(seed, expressionKey)
    cq = (ref?.nominalCq ?? 18) + refDrift + (gene.nominalCq - (ref?.nominalCq ?? 18)) - logFold / Math.LN2
  }
  cq += group.technicalCqSD * noiseScale * draw('technical-cq')
  const referenceCurves = project.simulation.curveModel === 'reference-v1'
  return {
    cq, tm: gene.tmC + project.simulation.tmSD * noiseScale * draw('tm'),
    plateau: Math.exp(Math.log(1.12) + (referenceCurves ? 0.14 : 0.07) * draw('plateau')),
    slope: Math.exp(Math.log(referenceCurves ? 0.54 : 0.85) + (referenceCurves ? 0.14 : 0.055) * draw('slope')),
    noise: project.simulation.fluorescenceNoise * noiseScale,
    baseline: referenceCurves ? 0.05 + 0.025 * randomFor(seed, `${key}/baseline`) : 0.018 + 0.005 * randomFor(seed, `${key}/baseline`),
    fwhm: gene.meltFwhmC,
  }
}

type PendingSample = Omit<SampleAnalysis, 'deltaDeltaCq' | 'fold'>

export function simulate(project: QPCRProject): SimulationResult {
  const wells: Well[] = []
  const qc: QCResult[] = []
  const samples: SampleAnalysis[] = []
  const groups: GroupAnalysis[] = []
  const comparisons: ComparisonResult[] = []
  const wellsById = new Map<string, Well>()
  const result = (): SimulationResult => ({ wells, samples, groups, comparisons, qc, totalWells: wells.length, plateCount: Math.ceil(wells.length / 96) })
  const add = (issue: QCResult) => {
    qc.push(issue)
    if (issue.wellIds) for (const id of issue.wellIds) wellsById.get(id)?.qc.push(issue)
  }
  const fail = (id: string, message: string) => add({ id, level: 'fail', message })
  const refs = project.genes.filter(gene => gene.type === 'reference')
  const targets = project.genes.filter(gene => gene.type === 'target')
  const controls = project.groups.filter(group => group.isCalibrator)
  if (refs.length !== 1) fail('reference-definition', '必须恰好设置一个内参基因。')
  if (!targets.length) fail('target-definition', '尚未设置目的基因。')
  if (controls.length !== 1) fail('calibrator-definition', '必须恰好设置一个校准对照组。')
  if (!project.groups.length) fail('groups-definition', '尚未设置实验组。')
  if (new Set(project.groups.map(group => group.id)).size !== project.groups.length || new Set(project.genes.map(gene => gene.id)).size !== project.genes.length) {
    fail('duplicate-ids', '组或基因标识重复，无法建立可靠计算链。')
    return result()
  }
  let required = 0
  for (const group of project.groups) {
    if (!isPositiveInteger(group.biologicalReplicates) || !isPositiveInteger(group.technicalReplicates) || !finite(group.technicalCqSD) || group.technicalCqSD < 0) {
      fail(`replicates/${group.id}`, `${group.name}：重复数需为正整数，技术 Cq SD 需为非负数。`)
      return result()
    }
    required += (project.replicateMode === 'technical' ? 1 : group.biologicalReplicates) * group.technicalReplicates * project.genes.length
    for (const gene of targets) {
      const config = group.targetFoldByGene[gene.id]
      if (config && ((!group.isCalibrator && !(finite(config.mean) && config.mean > 0)) || !finite(config.sd) || config.sd < 0)) {
        fail(`fold/${group.id}/${gene.id}`, `${group.name} / ${gene.name}：倍数均值应大于 0，SD 不得为负。`)
        return result()
      }
    }
  }
  if (required > MAX_WELLS) { fail('capacity', `当前需要 ${required} 孔，超过本地预览单项目 ${MAX_WELLS} 孔上限。`); return result() }
  if (!isPositiveInteger(project.protocol.cycles) || project.protocol.cycles > 100) { fail('cycles', '扩增循环数需在 1–100 之间。'); return result() }
  if (![project.simulation.referenceCqSD, project.simulation.tmSD, project.simulation.fluorescenceNoise].every(value => finite(value) && value >= 0)) {
    fail('simulation-variability', '模拟噪声和 SD 必须为非负有限数值。'); return result()
  }
  for (const gene of project.genes) {
    if (![gene.nominalCq, gene.tmC, gene.meltFwhmC].every(finite) || gene.meltFwhmC <= 0) { fail(`gene/${gene.id}`, `${gene.name}：基因参数无效。`); return result() }
  }
  for (const group of project.groups) {
    const biologicalN = project.replicateMode === 'technical' ? 1 : group.biologicalReplicates
    for (let bio = 1; bio <= biologicalN; bio++) for (const gene of project.genes) for (let tech = 1; tech <= group.technicalReplicates; tech++) {
      const key = `${group.id}/${bio}/${gene.id}/${tech}`
      const position = wells.length % 96
      const plateIndex = Math.floor(wells.length / 96)
      const row = String.fromCharCode(65 + Math.floor(position / 12))
      const column = position % 12 + 1
      const wellId = `${row}${column}`
      const generated = generatedValues(project, group.id, bio, gene, tech)
      const override = project.manualOverrides[key] ?? {}
      const manual = project.inputMode === 'manual' ? project.manualCq[key] : undefined
      const { excluded = false, ...valueOverrides } = override
      const values = { ...generated, ...(manual === undefined ? {} : { cq: manual }), ...valueOverrides }
      const well: Well = { id: `${plateIndex + 1}/${wellId}`, key, wellId, plateIndex, row, column, groupId: group.id, geneId: gene.id, sampleId: `${group.id}/${bio}`, biologicalReplicate: bio, technicalReplicate: tech, generated, values, excluded, adjusted: Object.keys(override).length > 0 || manual !== undefined, qc: [] }
      wells.push(well)
      wellsById.set(well.id, well)
      if (excluded) add({ id: `excluded/${key}`, level: 'warning', message: `${group.name} / ${gene.name} / ${wellId} 已排除，不参与计算。`, wellIds: [well.id] })
      if (project.inputMode === 'manual' && manual === undefined && override.cq === undefined && !excluded) {
        // Retain a curve preview, but missing user Cq never enters the analysis.
        well.values.cq = NaN
        add({ id: `manual-missing/${key}`, level: 'fail', message: `${wellId} 尚未填写手动 Cq。`, wellIds: [well.id] })
      }
      if (!excluded && (!finite(values.cq) || values.cq <= 0 || values.cq > project.protocol.cycles)) add({ id: `cq-range/${key}`, level: 'fail', message: `${wellId} Cq 缺失或超出当前循环范围，不参与 ΔCq 计算。`, wellIds: [well.id] })
      if (![values.tm, values.plateau, values.slope, values.noise, values.baseline, values.fwhm].every(finite) || values.plateau <= 0 || values.slope <= 0 || values.noise < 0 || values.fwhm <= 0) {
        add({ id: `curve-values/${key}`, level: 'fail', message: `${wellId} 曲线参数无效。`, wellIds: [well.id] })
      }
      const tmDeviation = Math.abs(values.tm - gene.tmC)
      if (!excluded && tmDeviation > project.simulation.tmWarning) add({ id: `tm/${key}`, level: tmDeviation > project.simulation.tmFail ? 'fail' : 'warning', message: `${wellId} Tm 偏离预期 ${tmDeviation.toFixed(2)} °C。`, wellIds: [well.id] })
    }
  }
  validatePlateWells(wells).forEach(add)
  const usable = (well: Well) => !well.excluded && finite(well.values.cq) && well.values.cq > 0 && well.values.cq <= project.protocol.cycles
  const bySampleGene = new Map<string, Well[]>()
  for (const well of wells) {
    const key = `${well.sampleId}/${well.geneId}`
    bySampleGene.set(key, [...(bySampleGene.get(key) ?? []), well])
  }
  for (const [key, assigned] of bySampleGene) {
    const active = assigned.filter(usable)
    const cqs = active.map(well => well.values.cq)
    const sd = sampleSD(cqs)
    if (sd > project.simulation.cqWarningSD) add({ id: `technical-sd/${key}`, level: sd > project.simulation.cqFailSD ? 'fail' : 'warning', message: `${key} 技术重复 Cq SD = ${sd.toFixed(3)}，超过设定阈值。`, wellIds: active.map(well => well.id), sampleIds: [assigned[0].sampleId] })
    if (cqs.length >= 3) {
      const center = median(cqs)
      const mad = median(cqs.map(value => Math.abs(value - center)))
      for (const well of active) if (Math.abs(well.values.cq - center) > Math.max(0.5, 3 * 1.4826 * mad)) add({ id: `cq-outlier/${well.key}`, level: 'warning', message: `${well.wellId} Cq 偏离本技术重复组中位数（MAD 规则）；未自动剔除。`, wellIds: [well.id] })
    }
  }
  if (project.replicateMode === 'technical') add({ id: 'technical-preview', level: 'warning', message: '当前为技术重复预览；图中 n 与 p 值不代表独立生物学重复，不能用于统计推断。' })
  if (refs.length !== 1 || controls.length !== 1) return result()
  const pending: PendingSample[] = []
  for (const group of project.groups) {
    const biologicalN = project.replicateMode === 'technical' ? 1 : group.biologicalReplicates
    for (let bio = 1; bio <= biologicalN; bio++) for (const gene of targets) {
      const sampleId = `${group.id}/${bio}`
      const referenceWells = (bySampleGene.get(`${sampleId}/${refs[0].id}`) ?? []).filter(usable)
      const targetWells = (bySampleGene.get(`${sampleId}/${gene.id}`) ?? []).filter(usable)
      const units = project.replicateMode === 'technical' ? group.technicalReplicates : 1
      for (let unit = 1; unit <= units; unit++) {
        const refsForUnit = project.replicateMode === 'technical' ? referenceWells.filter(well => well.technicalReplicate === unit) : referenceWells
        const targetsForUnit = project.replicateMode === 'technical' ? targetWells.filter(well => well.technicalReplicate === unit) : targetWells
        const id = `${sampleId}/${gene.id}${project.replicateMode === 'technical' ? `/${unit}` : ''}`
        if (!refsForUnit.length || !targetsForUnit.length) {
          add({ id: `missing/${id}`, level: 'fail', message: `${group.name} / ${gene.name} / R${project.replicateMode === 'technical' ? unit : bio} 缺少有效${!refsForUnit.length ? '内参' : '目的基因'} Cq，计算链不完整。`, sampleIds: [sampleId] })
          continue
        }
        const referenceCq = mean(refsForUnit.map(well => well.values.cq))
        const targetCq = mean(targetsForUnit.map(well => well.values.cq))
        pending.push({ id, groupId: group.id, geneId: gene.id, replicate: project.replicateMode === 'technical' ? unit : bio, referenceCq, targetCq, deltaCq: targetCq - referenceCq, technicalN: Math.min(refsForUnit.length, targetsForUnit.length), inferential: project.replicateMode === 'biological' })
      }
    }
  }
  for (const gene of targets) {
    const controlDelta = pending.filter(sample => sample.geneId === gene.id && sample.groupId === controls[0].id).map(sample => sample.deltaCq)
    if (!controlDelta.length) {
      fail(`calibration/${gene.id}`, `${gene.name} 的校准组无有效 ΔCq；本基因无法计算 ΔΔCq 和表达倍数。`)
    } else {
      const controlMean = mean(controlDelta)
      for (const sample of pending.filter(item => item.geneId === gene.id)) {
        const deltaDeltaCq = sample.deltaCq - controlMean
        const fold = 2 ** -deltaDeltaCq
        if (!finite(fold) || fold <= 0) { fail(`fold-chain/${sample.id}`, `${sample.id} 表达倍数计算溢出。`); continue }
        samples.push({ ...sample, deltaDeltaCq, fold })
      }
    }
    for (const group of project.groups) {
      const groupSamples = samples.filter(sample => sample.groupId === group.id && sample.geneId === gene.id)
      const folds = groupSamples.map(sample => sample.fold)
      groups.push({ groupId: group.id, geneId: gene.id, n: folds.length, mean: mean(folds), sd: sampleSD(folds), geometricMean: geometricMean(folds), folds, deltaCqs: groupSamples.map(sample => sample.deltaCq), cqSD: sampleSD(groupSamples.map(sample => sample.targetCq)) })
    }
    const geneComparisons: ComparisonResult[] = project.comparisons.map(comparison => {
      const a = groups.find(group => group.groupId === comparison.leftGroupId && group.geneId === gene.id)
      const b = groups.find(group => group.groupId === comparison.rightGroupId && group.geneId === gene.id)
      const stats: WelchResult = comparison.leftGroupId === comparison.rightGroupId
        ? { p: null, statistic: null, df: null, status: 'not_applicable', reason: '不能比较同一实验组。' }
        : welchTest(a?.deltaCqs ?? [], b?.deltaCqs ?? [])
      return { ...comparison, geneId: gene.id, ...stats, rawP: stats.p, label: significance(stats.p), inferential: project.replicateMode === 'biological' && stats.status === 'ok' }
    })
    if (project.simulation.correction === 'holm') {
      const adjusted = holmAdjust(geneComparisons.map(comparison => comparison.rawP))
      geneComparisons.forEach((comparison, index) => { comparison.p = adjusted[index]; comparison.label = significance(comparison.p) })
    }
    comparisons.push(...geneComparisons)
    for (const comparison of geneComparisons) if (comparison.status !== 'ok') add({ id: `statistics/${gene.id}/${comparison.id}`, level: 'warning', message: `组间检验不可用：${comparison.reason}` })
  }
  const { threshold, baselineStartCycle, baselineEndCycle, mode } = project.protocol.cqDetection
  if (!(finite(threshold) && threshold > 0) || (mode === 'baseline-delta-f' && (!isPositiveInteger(baselineStartCycle) || baselineStartCycle >= baselineEndCycle || baselineEndCycle > project.protocol.cycles))) fail('threshold-configuration', 'Cq 阈值或基线周期配置无效。')
  const uncertain = wells.filter(well => usable(well) && !amplificationModel(well, project).aligned)
  if (uncertain.length) add({ id: 'threshold-alignment', level: 'warning', message: `${uncertain.length} 孔的阈值无法在当前基线/幅度下与输入 Cq 对齐；Cq 仍为输入/模拟潜在值，未从曲线提取。`, wellIds: uncertain.map(well => well.id) })
  if (!qc.some(issue => issue.level !== 'pass')) add({ id: 'calculation-integrity', level: 'pass', message: '孔位、内参/目的基因聚合、ΔCq、ΔΔCq 和表达倍数计算链完整。' })
  return result()
}

const logistic = (cycle: number, center: number, slope: number) => 1 / (1 + Math.exp(-slope * (cycle - center)))

function amplificationModel(well: Well, project: QPCRProject): { center: number; amplitude: number; aligned: boolean } {
  if (project.simulation.curveModel === 'reference-v1') return referenceAmplificationModel(well, project)
  const { cq, plateau, slope, baseline } = well.values
  const amplitude = plateau * project.protocol.quantFactor / 20
  const settings = project.protocol.cqDetection
  const fallback = { center: finite(cq) ? cq : project.protocol.cycles / 2, amplitude, aligned: false }
  if (!(finite(cq) && slope > 0 && amplitude > 0 && finite(amplitude) && settings.threshold > 0)) return fallback
  if (settings.mode === 'fixed-threshold') {
    const fraction = (settings.threshold - baseline) / amplitude
    return fraction > 0 && fraction < 1 ? { center: cq + Math.log(1 / fraction - 1) / slope, amplitude, aligned: true } : fallback
  }
  const start = settings.baselineStartCycle
  const end = settings.baselineEndCycle
  if (!isPositiveInteger(start) || start >= end || end >= cq) return fallback
  // Find the later logistic center satisfying F(Cq) - mean(F_baseline) = threshold.
  // Noise is added only after calibration; this is not curve-fitted Cq extraction.
  const crossing = (center: number) => {
    let total = 0
    for (let cycle = start; cycle <= end; cycle++) total += logistic(cycle, center, slope)
    return amplitude * (logistic(cq, center, slope) - total / (end - start + 1)) - settings.threshold
  }
  const lowBound = start - 12 / slope
  const highBound = cq + 24 / slope
  let lower = lowBound
  let previous = crossing(lower)
  let bracket: [number, number] | null = null
  for (let i = 1; i <= 64; i++) {
    const upper = lowBound + (highBound - lowBound) * i / 64
    const current = crossing(upper)
    if (previous >= 0 && current <= 0) bracket = [lower, upper]
    lower = upper
    previous = current
  }
  if (!bracket) return fallback
  let [left, right] = bracket
  for (let i = 0; i < 48; i++) {
    const center = (left + right) / 2
    if (crossing(center) > 0) left = center
    else right = center
  }
  return { center: (left + right) / 2, amplitude, aligned: true }
}

export function amplificationCurve(well: Well, project: QPCRProject): CurvePoint[] {
  const values = well.values
  if (![values.cq, values.plateau, values.slope, values.noise, values.baseline].every(finite) || values.plateau <= 0 || values.slope <= 0 || values.noise < 0) return []
  if (project.simulation.curveModel === 'reference-v1') return referenceAmplificationCurve(well, project)
  const { center, amplitude } = amplificationModel(well, project)
  if (!finite(amplitude) || amplitude <= 0) return []
  const points: CurvePoint[] = []
  const revision = project.rowSeeds[`${well.groupId}/${well.geneId}`] ?? 0
  for (let cycle = 1; cycle <= project.protocol.cycles; cycle++) {
    const noise = values.noise * normalFor(project.randomSeed, `${well.key}/amplification/${cycle}/row-${revision}`)
    points.push({ x: cycle, y: values.baseline + amplitude * logistic(cycle, center, values.slope) + noise })
  }
  return points
}

export function meltingCurve(well: Well, project: QPCRProject): CurvePoint[] {
  const { tm, fwhm, plateau, noise } = well.values
  if (![tm, fwhm, plateau, noise].every(finite) || fwhm <= 0 || plateau <= 0 || noise < 0) return []
  const start = project.protocol.meltLow.temperatureC
  const end = project.protocol.meltEnd.temperatureC
  const density = project.protocol.readingsPerC
  if (![start, end, density].every(finite) || end <= start || density <= 0 || (end - start) * density > 10000) return []
  if (project.simulation.curveModel === 'reference-v1') return referenceMeltingCurve(well, project)
  const sigma = fwhm / 2.35482
  const points: CurvePoint[] = []
  const steps = Math.ceil((end - start) * density)
  const revision = project.rowSeeds[`${well.groupId}/${well.geneId}`] ?? 0
  for (let index = 0; index <= steps; index++) {
    const temperature = Math.min(end, start + index / density)
    const jitter = noise * normalFor(project.randomSeed, `${well.key}/melting/${temperature.toFixed(8)}/row-${revision}`)
    const y = plateau * project.protocol.meltFactor * Math.exp(-((temperature - tm) ** 2) / (2 * sigma ** 2)) + jitter
    points.push({ x: temperature, y })
  }
  return points
}

const bounded = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

function curveKey(well: Well, project: QPCRProject): string {
  return `${well.key}/reference-v1/row-${project.rowSeeds[`${well.groupId}/${well.geneId}`] ?? 0}`
}

function referenceShape(well: Well, project: QPCRProject) {
  const key = curveKey(well, project)
  return {
    exponent: bounded(1.7 + 0.12 * normalFor(project.randomSeed, `${key}/exponent`), 1.3, 2.1),
    drift: (0.00025 + 0.0004 * normalFor(project.randomSeed, `${key}/baseline-drift`)) * well.values.noise / 0.004,
  }
}

function referenceSignal(well: Well, project: QPCRProject, center: number, amplitude: number, cycle: number, shape: ReturnType<typeof referenceShape>): number {
  const fraction = logistic(cycle, center, well.values.slope) ** shape.exponent
  return well.values.baseline + amplitude * (fraction + shape.drift * (cycle - project.protocol.cqDetection.baselineStartCycle))
}

function referenceAmplificationModel(well: Well, project: QPCRProject): { center: number; amplitude: number; aligned: boolean } {
  const { cq, plateau, slope, noise, baseline } = well.values
  const amplitude = plateau * project.protocol.quantFactor / 20
  const settings = project.protocol.cqDetection
  const fallback = { center: finite(cq) ? cq : project.protocol.cycles / 2, amplitude, aligned: false }
  if (![cq, plateau, slope, noise, baseline, amplitude].every(finite) || !(cq > 0 && cq <= project.protocol.cycles && slope > 0 && amplitude > 0 && noise >= 0 && settings.threshold > 0)) return fallback
  const shape = referenceShape(well, project)
  if (settings.mode === 'fixed-threshold') {
    const driftAtCq = amplitude * shape.drift * (cq - settings.baselineStartCycle)
    const fraction = (settings.threshold - baseline - driftAtCq) / amplitude
    if (!(fraction > 0 && fraction < 1)) return fallback
    return { center: cq + Math.log(fraction ** (-1 / shape.exponent) - 1) / slope, amplitude, aligned: true }
  }
  const start = settings.baselineStartCycle
  const end = settings.baselineEndCycle
  if (!isPositiveInteger(start) || start >= end || end >= cq) return fallback
  const crossing = (center: number) => {
    let total = 0
    for (let cycle = start; cycle <= end; cycle++) total += referenceSignal(well, project, center, amplitude, cycle, shape)
    return referenceSignal(well, project, center, amplitude, cq, shape) - total / (end - start + 1) - settings.threshold
  }
  const lowBound = start - 16 / slope
  const highBound = cq + 28 / slope
  let lower = lowBound
  let previous = crossing(lower)
  let bracket: [number, number] | null = null
  for (let i = 1; i <= 72; i++) {
    const upper = lowBound + (highBound - lowBound) * i / 72
    const current = crossing(upper)
    if (previous >= 0 && current <= 0) bracket = [lower, upper]
    lower = upper
    previous = current
  }
  if (!bracket) return fallback
  let [left, right] = bracket
  for (let i = 0; i < 48; i++) {
    const center = (left + right) / 2
    if (crossing(center) > 0) left = center
    else right = center
  }
  return { center: (left + right) / 2, amplitude, aligned: true }
}

function referenceAmplificationCurve(well: Well, project: QPCRProject): CurvePoint[] {
  if (well.values.cq <= 0 || well.values.cq > project.protocol.cycles) return []
  const model = referenceAmplificationModel(well, project)
  if (!(finite(model.amplitude) && model.amplitude > 0)) return []
  const key = curveKey(well, project)
  const shape = referenceShape(well, project)
  const points: CurvePoint[] = []
  let withinWell = normalFor(project.randomSeed, `${key}/noise-start`)
  let commonPlate = normalFor(project.randomSeed, `reference-v1/plate/${well.plateIndex}/noise-start`)
  for (let cycle = 1; cycle <= project.protocol.cycles; cycle++) {
    withinWell = 0.4 * withinWell + Math.sqrt(1 - 0.4 ** 2) * normalFor(project.randomSeed, `${key}/noise/${cycle}`)
    commonPlate = 0.45 * commonPlate + Math.sqrt(1 - 0.45 ** 2) * normalFor(project.randomSeed, `reference-v1/plate/${well.plateIndex}/noise/${cycle}`)
    const fraction = logistic(cycle, model.center, well.values.slope) ** shape.exponent
    const noiseSD = well.values.noise * (0.18 + 0.52 * Math.sqrt(fraction))
    const noise = noiseSD * (0.95 * withinWell + Math.sqrt(1 - 0.95 ** 2) * commonPlate)
    points.push({ x: cycle, y: referenceSignal(well, project, model.center, model.amplitude, cycle, shape) + noise })
  }
  return points
}

function referenceMeltingCurve(well: Well, project: QPCRProject): CurvePoint[] {
  const { tm, fwhm, plateau, noise } = well.values
  const start = project.protocol.meltLow.temperatureC
  const end = project.protocol.meltEnd.temperatureC
  const density = project.protocol.readingsPerC
  const amplitude = plateau * project.protocol.meltFactor
  if (!(finite(amplitude) && amplitude > 0)) return []
  const key = curveKey(well, project)
  // Split Gaussian: sigma_left + sigma_right keeps the configured total FWHM.
  const rightLeftRatio = bounded(0.9 + 0.035 * normalFor(project.randomSeed, `${key}/melt-asymmetry`), 0.8, 1.03)
  const sigmaLeft = fwhm / (Math.sqrt(2 * Math.log(2)) * (1 + rightLeftRatio))
  const sigmaRight = sigmaLeft * rightLeftRatio
  const background = amplitude * 0.08
  const points: CurvePoint[] = []
  let correlated = normalFor(project.randomSeed, `${key}/melt-noise-start`)
  const steps = Math.ceil((end - start) * density)
  for (let index = 0; index <= steps; index++) {
    const temperature = Math.min(end, start + index / density)
    const sigma = temperature < tm ? sigmaLeft : sigmaRight
    const peakFraction = Math.exp(-((temperature - tm) ** 2) / (2 * sigma ** 2))
    correlated = 0.6 * correlated + 0.8 * normalFor(project.randomSeed, `${key}/melt-noise/${temperature.toFixed(8)}`)
    const jitter = noise * (0.18 + 0.22 * peakFraction) * correlated
    points.push({ x: temperature, y: background + amplitude * peakFraction + jitter })
  }
  return points
}

export interface AmplificationObservation { cycle: number; rn: number; deltaRn: number; baseline: number }
export interface MeltingObservation { reading: number; temperature: number; fluorescence: number; derivative: number }

/** Synthetic normalized signal, not calibrated detector Rn or a vendor baseline fit. */
export function rawAmplificationData(well: Well, project: QPCRProject): AmplificationObservation[] {
  const points = amplificationCurve(well, project)
  const { baselineStartCycle: start, baselineEndCycle: end } = project.protocol.cqDetection
  const baseline = mean(points.filter(point => point.x >= start && point.x <= end).map(point => point.y))
  return points.map(point => ({ cycle: point.x, rn: point.y, deltaRn: point.y - baseline, baseline }))
}

/** Backward trapezoid integration keeps the exported F and plotted derivative coherent.
 * It is a discrete synthetic integral, not the original instrument's smoothing algorithm.
 */
export function rawMeltingData(well: Well, project: QPCRProject): MeltingObservation[] {
  const points = meltingCurve(well, project)
  if (!points.length || !finite(well.values.baseline)) return []
  const observations: MeltingObservation[] = Array(points.length)
  let fluorescence = well.values.baseline
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index]
    if (index < points.length - 1) {
      const next = points[index + 1]
      fluorescence += (point.y + next.y) * (next.x - point.x) / 2
    }
    observations[index] = { reading: index + 1, temperature: point.x, fluorescence, derivative: point.y }
  }
  if (!observations.every(observation => finite(observation.fluorescence))) return []
  const offset = Math.max(0, -Math.min(...observations.map(observation => observation.fluorescence)))
  if (offset > 0) for (const observation of observations) observation.fluorescence += offset
  return observations
}
