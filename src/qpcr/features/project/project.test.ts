import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../../defaults'
import { migrateProject, parseProject, serializeProject } from './index'

describe('versioned project persistence', () => {
  it('round trips project settings and stable per-well overrides exactly', () => {
    const project = createDefaultProject()
    project.manualOverrides['g1/1/target1/1'] = { cq: 24.125, excluded: true, plateau: 1.8 }
    project.manualCq['g2/2/ref1/2'] = 18.246
    project.rowSeeds['g2/target1'] = 99
    const saved = serializeProject(project)
    expect(JSON.parse(saved).schemaVersion).toBe(1)
    expect(JSON.parse(saved).simulationAlgorithmVersion).toBe(2)
    expect(parseProject(saved)).toEqual(project)
  })

  it('rejects malformed JSON and unsupported file and algorithm versions', () => {
    expect(() => parseProject('{no')).toThrow('有效的 JSON')
    expect(() => migrateProject({ schemaVersion: 2, simulationAlgorithmVersion: 1, project: createDefaultProject() })).toThrow('不支持的项目文件版本')
    expect(() => migrateProject({ schemaVersion: 1, simulationAlgorithmVersion: 3, project: createDefaultProject() })).toThrow('不支持的模拟算法版本')
    expect(() => parseProject('{}')).toThrow('不支持的项目文件版本')
  })

  it('preserves algorithm-1 projects without silently upgrading their curves', () => {
    const oldProject = createDefaultProject()
    delete oldProject.simulation.curveModel
    const envelope = { schemaVersion: 1, simulationAlgorithmVersion: 1, project: oldProject }
    const loaded = migrateProject(envelope)
    expect(loaded).toEqual(oldProject)
    expect(JSON.parse(serializeProject(loaded)).simulationAlgorithmVersion).toBe(1)
    expect(() => migrateProject({ ...envelope, simulationAlgorithmVersion: 2 })).toThrow('不一致')
    loaded.simulation.curveModel = 'reference-v1'
    expect(JSON.parse(serializeProject(loaded)).simulationAlgorithmVersion).toBe(2)
    expect(() => migrateProject({ ...envelope, project: loaded })).toThrow('不一致')
  })

  it('requires one calibrator, a unique reference, valid groups and complete folds', () => {
    const project = createDefaultProject()
    project.groups[0].isCalibrator = false
    expect(() => serializeProject(project)).toThrow('校准组')
    project.groups[0].isCalibrator = true
    project.genes[1].type = 'reference'
    expect(() => serializeProject(project)).toThrow('内参基因')
    project.genes[1].type = 'target'
    project.groups[1].id = project.groups[0].id
    expect(() => serializeProject(project)).toThrow('标识重复')
    project.groups[1].id = 'g2'
    delete project.groups[1].targetFoldByGene.target1
    expect(() => serializeProject(project)).toThrow('表达参数')
  })

  it('rejects invalid comparisons and unknown manual edits', () => {
    const project = createDefaultProject()
    project.comparisons[0].rightGroupId = 'missing'
    expect(() => serializeProject(project)).toThrow('不存在的实验组')
    project.comparisons[0].rightGroupId = 'g1'
    expect(() => serializeProject(project)).toThrow('两个不同的组')
    project.comparisons[0].rightGroupId = 'g2'
    project.manualOverrides['g1/1/missing/1'] = { cq: 20 }
    expect(() => serializeProject(project)).toThrow('手动孔记录')
  })

  it('rejects non-finite and excessive numeric inputs, invalid QC thresholds and baseline intervals', () => {
    const project = createDefaultProject()
    project.groups[0].technicalCqSD = Number.NaN
    expect(() => serializeProject(project)).toThrow('项目配置无效')
    project.groups[0].technicalCqSD = 0.1
    project.groups[0].biologicalReplicates = 1000000
    expect(() => serializeProject(project)).toThrow('项目配置无效')
    project.groups[0].biologicalReplicates = 3
    project.simulation.cqWarningSD = 2
    expect(() => serializeProject(project)).toThrow('警告阈值')
    project.simulation.cqWarningSD = 0.3
    project.protocol.cqDetection.baselineEndCycle = project.protocol.cycles
    expect(() => serializeProject(project)).toThrow('基线区间')
  })

  it('rejects unknown nested fields rather than silently discarding them', () => {
    const envelope = JSON.parse(serializeProject(createDefaultProject()))
    envelope.project.protocol.unknownField = 100
    expect(() => parseProject(JSON.stringify(envelope))).toThrow('项目配置无效')
  })
})
