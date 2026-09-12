import { z } from 'zod'
import type { QPCRProject } from '../../models'

export const SCHEMA_VERSION = 1
export const SIMULATION_ALGORITHM_VERSION = 2
export const getSimulationAlgorithmVersion = (project: QPCRProject): 1 | 2 => project.simulation.curveModel === 'reference-v1' ? 2 : 1
const AUTOSAVE_KEY = 'qpcr-data-studio-project-v1'
const finite = z.number().finite('必须是有限数字')
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, '标识仅支持字母、数字、下划线和短横线').refine(value => !['__proto__', 'prototype', 'constructor'].includes(value), '标识不能使用保留名称')
const name = z.string().min(1).max(200).refine(value => value.trim().length > 0, '名称不能为空')
const seed = finite.int().min(0).max(4294967295)
const cq = finite.min(0).max(80)
const temperature = finite.min(0).max(110)
const sd = finite.min(0).max(20)
const fold = z.object({ mean: finite.positive().max(1000000), sd: finite.min(0).max(1000000), sdMode: z.enum(['auto', 'manual']) }).strict()
const step = z.object({
  temperatureC: temperature, holdSeconds: finite.min(0).max(7200),
  rampRateCPerSec: finite.positive().max(100), acquisition: z.enum(['none', 'single', 'continuous']),
}).strict()
const override = z.object({
  cq: cq.optional(), tm: temperature.optional(), plateau: finite.positive().max(1000).optional(),
  slope: finite.positive().max(20).optional(), noise: finite.min(0).max(10).optional(),
  baseline: finite.min(0).max(100).optional(), fwhm: finite.positive().max(30).optional(), excluded: z.boolean().optional(),
}).strict()

export const projectSchema = z.object({
  id, name, theme: z.enum(['light', 'dark']), randomSeed: seed,
  replicateMode: z.enum(['biological', 'technical']), inputMode: z.enum(['distribution', 'manual']),
  groups: z.array(z.object({
    id, name, isCalibrator: z.boolean(), biologicalReplicates: finite.int().min(1).max(100),
    technicalReplicates: finite.int().min(1).max(12), technicalCqSD: sd, targetFoldByGene: z.record(id, fold),
  }).strict()).min(1).max(48),
  genes: z.array(z.object({
    id, name, type: z.enum(['reference', 'target']), nominalCq: cq, tmC: temperature,
    primerConcentration: finite.min(0).max(100), meltFwhmC: finite.positive().max(30),
  }).strict()).min(2).max(25),
  comparisons: z.array(z.object({ id, leftGroupId: id, rightGroupId: id }).strict()).max(1128),
  protocol: z.object({
    mode: z.enum(['two-step', 'three-step']), cycles: finite.int().min(3).max(100),
    preincubation: step, denaturation: step, annealing: step, extension: step,
    meltHigh: step, meltLow: step, meltEnd: step, cooling: step, coolingEnabled: z.boolean(),
    readingsPerC: finite.int().min(1).max(50), channel: name, volume: finite.positive().max(1000),
    quantFactor: finite.positive().max(100000), meltFactor: finite.positive().max(100000),
    acquisitionMode: z.enum(['dynamic', 'fixed']),
    cqDetection: z.object({
      mode: z.enum(['baseline-delta-f', 'fixed-threshold']), threshold: finite.positive().max(1000),
      baselineStartCycle: finite.int().min(1).max(99), baselineEndCycle: finite.int().min(2).max(99),
    }).strict(),
  }).strict(),
  simulation: z.object({
    curveModel: z.enum(['legacy-v1', 'reference-v1']).optional(),
    preset: z.enum(['realistic', 'precision']), noiseLevel: z.enum(['low', 'medium', 'high']),
    referenceCqSD: sd, fluorescenceNoise: finite.min(0).max(10), tmSD: sd,
    cqWarningSD: sd, cqFailSD: sd, tmWarning: sd, tmFail: sd, correction: z.enum(['none', 'holm']),
  }).strict(),
  manualOverrides: z.record(override), manualCq: z.record(cq), rowSeeds: z.record(seed),
}).strict().superRefine((project, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
  if (new Set(project.groups.map(group => group.id)).size !== project.groups.length) issue('实验组标识重复', ['groups'])
  if (new Set(project.genes.map(gene => gene.id)).size !== project.genes.length) issue('检测基因标识重复', ['genes'])
  if (project.groups.filter(group => group.isCalibrator).length !== 1) issue('必须且只能设置一个校准组', ['groups'])
  if (project.genes.filter(gene => gene.type === 'reference').length !== 1) issue('必须且只能设置一个内参基因', ['genes'])
  const targets = project.genes.filter(gene => gene.type === 'target')
  if (!targets.length) issue('至少需要一个目的基因', ['genes'])
  const targetIds = new Set(targets.map(gene => gene.id))
  project.groups.forEach((group, index) => {
    targets.forEach(gene => {
      if (!group.targetFoldByGene[gene.id]) issue('每个组都必须包含所有目的基因的表达参数', ['groups', index, 'targetFoldByGene', gene.id])
    })
    if (Object.keys(group.targetFoldByGene).some(key => !targetIds.has(key))) issue('表达参数包含未知目的基因', ['groups', index, 'targetFoldByGene'])
  })
  const requiredWells = project.groups.reduce((total, group) => total + (project.replicateMode === 'biological' ? group.biologicalReplicates : 1) * group.technicalReplicates * project.genes.length, 0)
  if (requiredWells > 9600) issue('本地预览最多支持 9,600 个实验孔，请减少重复数或检测基因', ['groups'])
  const groupIds = new Set(project.groups.map(group => group.id))
  const pairs = new Set<string>()
  const comparisonIds = new Set<string>()
  project.comparisons.forEach((comparison, index) => {
    if (!groupIds.has(comparison.leftGroupId) || !groupIds.has(comparison.rightGroupId)) issue('比较引用了不存在的实验组', ['comparisons', index])
    if (comparison.leftGroupId === comparison.rightGroupId) issue('组间比较必须选择两个不同的组', ['comparisons', index])
    const pair = [comparison.leftGroupId, comparison.rightGroupId].sort().join('/')
    if (pairs.has(pair) || comparisonIds.has(comparison.id)) issue('组间比较重复', ['comparisons', index])
    pairs.add(pair)
    comparisonIds.add(comparison.id)
  })
  if (project.simulation.cqWarningSD > project.simulation.cqFailSD) issue('Cq 警告阈值不能高于失败阈值', ['simulation', 'cqWarningSD'])
  if (project.simulation.tmWarning > project.simulation.tmFail) issue('Tm 警告阈值不能高于失败阈值', ['simulation', 'tmWarning'])
  const detection = project.protocol.cqDetection
  if (detection.baselineStartCycle >= detection.baselineEndCycle || detection.baselineEndCycle >= project.protocol.cycles) issue('基线区间应满足：起始循环 < 结束循环 < 总循环数', ['protocol', 'cqDetection'])
  if (project.protocol.meltLow.temperatureC >= project.protocol.meltEnd.temperatureC) issue('熔解终点温度必须高于起始温度', ['protocol', 'meltEnd'])
  const groupsById = new Map(project.groups.map(group => [group.id, group]))
  const geneIds = new Set(project.genes.map(gene => gene.id))
  const validWellKey = (key: string) => {
    const parts = key.split('/')
    if (parts.length !== 4 || !/^[1-9]\d*$/.test(parts[1]) || !/^[1-9]\d*$/.test(parts[3])) return false
    const group = groupsById.get(parts[0])
    // Preserve inactive biological repeats when switching to technical-only preview.
    return group && geneIds.has(parts[2]) && Number(parts[1]) <= group.biologicalReplicates && Number(parts[3]) <= group.technicalReplicates
  }
  for (const field of ['manualOverrides', 'manualCq'] as const) {
    if (Object.keys(project[field]).length > 9600) issue('手动孔记录数量超过上限', [field])
    for (const key of Object.keys(project[field])) if (!validWellKey(key)) issue('手动孔记录引用了不存在的组、基因或重复', [field, key])
  }
  for (const key of Object.keys(project.rowSeeds)) {
    const parts = key.split('/')
    if (parts.length !== 2 || !groupsById.has(parts[0]) || !geneIds.has(parts[1])) issue('行随机种子引用了不存在的组或基因', ['rowSeeds', key])
  }
})

export function migrateProject(input: unknown): QPCRProject {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('项目文件格式无效：需要版本化 JSON 对象')
  const envelope = input as Record<string, unknown>
  if (envelope.schemaVersion !== SCHEMA_VERSION) throw new Error(`不支持的项目文件版本：${String(envelope.schemaVersion)}。当前仅支持 schemaVersion = 1`)
  if (envelope.simulationAlgorithmVersion !== 1 && envelope.simulationAlgorithmVersion !== SIMULATION_ALGORITHM_VERSION) throw new Error(`不支持的模拟算法版本：${String(envelope.simulationAlgorithmVersion)}。当前支持版本 1、2`)
  if (Object.keys(envelope).some(key => !['schemaVersion', 'simulationAlgorithmVersion', 'project'].includes(key))) throw new Error('项目文件包含未知顶层字段')
  const parsed = projectSchema.safeParse(envelope.project)
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 4).map(item => `${item.path.join('.') || 'project'}：${item.message}`).join('；')
    throw new Error(`项目配置无效：${detail}`)
  }
  if (getSimulationAlgorithmVersion(parsed.data) !== envelope.simulationAlgorithmVersion) throw new Error('模拟算法版本与曲线模型不一致，请检查项目文件')
  return parsed.data
}

export function serializeProject(project: QPCRProject): string {
  const envelope = { schemaVersion: SCHEMA_VERSION, simulationAlgorithmVersion: getSimulationAlgorithmVersion(project), project }
  migrateProject(envelope)
  return JSON.stringify(envelope, null, 2)
}

export function parseProject(text: string): QPCRProject {
  if (text.length > 5_000_000) throw new Error('项目文件超过 5 MB，请使用较小的项目文件')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('项目文件不是有效的 JSON，请选择 .qpcr.json 文件') }
  return migrateProject(value)
}

export function saveAutosave(project: QPCRProject): void {
  localStorage.setItem(AUTOSAVE_KEY, serializeProject(project))
}

export function loadAutosave(): QPCRProject | null {
  const saved = localStorage.getItem(AUTOSAVE_KEY)
  return saved ? parseProject(saved) : null
}
