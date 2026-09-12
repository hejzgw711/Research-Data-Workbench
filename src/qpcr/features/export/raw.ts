import type { QPCRProject, SimulationResult, Well } from '../../models'
import { rawAmplificationData, rawMeltingData } from '../../domain/qpcr'
import { getSimulationAlgorithmVersion } from '../project'

export type ExportCell = string | number | boolean | null
export interface RawTable { sheet: string; filename: string; columns: string[]; rows: ExportCell[][] }
export const MAX_RAW_EXPORT_CELLS = 2_000_000
export const RAW_COLUMNS = {
  setup: ['Well', 'Well Position', 'Sample', 'Target Name', 'Gene Role', 'Group', 'Biological Replicate', 'Technical Replicate', 'Excluded', 'Data Type', 'Stable Key'],
  amplification: ['Well', 'Well Position', 'Cycle', 'Target Name', 'Rn', 'Delta Rn', 'Simulated Baseline', 'Sample', 'Group', 'Biological Replicate', 'Technical Replicate', 'Cq', 'Excluded', 'Signal Status', 'Data Type', 'Stable Key'],
  meltRaw: ['Well', 'Well Position', 'Reading', 'Temperature', 'Fluorescence', 'Derivative', 'Target Name', 'Sample', 'Group', 'Biological Replicate', 'Technical Replicate', 'Cq Status', 'Excluded', 'Signal Status', 'Data Type', 'Stable Key'],
  meltResult: ['Well', 'Well Position', 'Sample', 'Target Name', 'Tm', 'Melt Peak Height', 'Tm Source', 'Peak Temperature (sampled)', 'Excluded', 'Data Type', 'Stable Key', 'Melt Terminal Fluorescence'],
  results: ['Well', 'Well Position', 'Sample', 'Target Name', 'Cq', 'Cq Source', 'Adjusted', 'Excluded', 'QC', 'Data Type', 'Stable Key'],
}

const finiteOrNull = (value: number): number | null => Number.isFinite(value) ? value : null
const curveModel = (project: QPCRProject) => project.simulation.curveModel ?? 'legacy-v1'
const positionNumber = (well: Well) => (well.row.charCodeAt(0) - 65) * 12 + well.column
const cqStatus = (well: Well, project: QPCRProject) => !Number.isFinite(well.values.cq) ? 'missing Cq' : well.values.cq <= 0 || well.values.cq > project.protocol.cycles ? 'Cq outside run cycles' : 'Cq available'

function sampleCounts(project: QPCRProject) {
  const cycles = project.protocol.cycles
  const start = project.protocol.meltLow.temperatureC
  const end = project.protocol.meltEnd.temperatureC
  const density = project.protocol.readingsPerC
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 100 || ![start, end, density].every(Number.isFinite) || end <= start || density <= 0) {
    throw new Error('无法导出完整原始数据：扩增循环或熔解温度/采样密度无效，请先检查 PCR 运行条件。')
  }
  const baseline = project.protocol.cqDetection
  if (!Number.isInteger(baseline.baselineStartCycle) || !Number.isInteger(baseline.baselineEndCycle) || baseline.baselineStartCycle < 1 || baseline.baselineStartCycle >= baseline.baselineEndCycle || baseline.baselineEndCycle >= cycles) {
    throw new Error('无法导出完整原始数据：Cq 基线区间须满足整数循环 1 ≤ 起始 < 结束 < 总循环数，请先修正基线设置。')
  }
  const meltReadings = Math.ceil((end - start) * density) + 1
  if (!Number.isSafeInteger(meltReadings) || meltReadings > 10001) throw new Error('熔解采样点过多，请降低 readings/°C 后重试原始数据导出。')
  return { cycles, meltReadings, start, end, density }
}

export function rawPlateIndexes(result: SimulationResult): number[] {
  return [...new Set(result.wells.map(well => well.plateIndex))].sort((a, b) => a - b)
}

export function assertRawExportSize(project: QPCRProject, result: SimulationResult): void {
  if (!result.wells.length) throw new Error('暂无已分配实验孔，请生成数据后再导出。')
  const { cycles, meltReadings } = sampleCounts(project)
  const cells = result.wells.length * (cycles * RAW_COLUMNS.amplification.length + meltReadings * RAW_COLUMNS.meltRaw.length + RAW_COLUMNS.setup.length + RAW_COLUMNS.meltResult.length + RAW_COLUMNS.results.length)
  if (!Number.isSafeInteger(cells) || cells > MAX_RAW_EXPORT_CELLS) throw new Error(`完整原始数据预计包含 ${cells.toLocaleString('zh-CN')} 个单元格，超过当前浏览器导出上限 2,000,000。请减少重复数、检测基因或熔解采样密度后重试；本次未截断或下载任何数据。`)
  const locations = new Set<string>()
  const perPlate = new Map<number, number>()
  for (const well of result.wells) {
    if (!Number.isInteger(well.plateIndex) || well.plateIndex < 0 || !/^[A-H]$/.test(well.row) || !Number.isInteger(well.column) || well.column < 1 || well.column > 12 || well.wellId !== `${well.row}${well.column}`) throw new Error('存在无效孔位，无法导出原始数据。')
    const location = `${well.plateIndex}/${well.wellId}`
    if (locations.has(location)) throw new Error('存在重复孔位，无法导出原始数据。')
    locations.add(location)
    perPlate.set(well.plateIndex, (perPlate.get(well.plateIndex) ?? 0) + 1)
  }
  if ([...perPlate.values()].some(count => count > 96 || count * Math.max(cycles, meltReadings) + 1 > 1048576)) throw new Error('单板原始数据超过工作表容量，请减少实验孔数或熔解采样密度。')
}

export function rawReadme(project: QPCRProject): string {
  return [
    'SIMULATED RAW DATA / 模拟原始数据',
    '',
    '本压缩包包含当前项目的分析数据与逐板模拟原始数据，所有数值由当前项目和随机种子生成。',
    '它仅参考用户提供工作簿的表结构，并非真实 PCR 仪下机文件，也未验证仪器软件导入兼容性。',
    `Curve model: ${curveModel(project)}; simulation algorithm version: ${getSimulationAlgorithmVersion(project)}; random seed: ${project.randomSeed}.`,
    '每板原始工作簿：Summary、Sample Setup、Amplification Data、Melt Curve Raw Data、Melt Curve Result、Results。',
    'Amplification Data 的 Rn 是界面绘制的合成荧光值（任意单位），不是经过被动参比或探测器校准的真实比值。',
    'Delta Rn 为 Rn 减去本孔配置基线循环区间内合成 Rn 的均值；Simulated Baseline 记录该基线。',
    'Melt Curve Raw Data 的 Derivative 与界面熔解曲线逐点相同。Fluorescence 通过该曲线按温度逆向梯形积分构造，默认终点值为当前孔 baseline。极端噪声导致积分值为负时，整条 Fluorescence 统一上移至最小值为 0，保持梯形差分关系；实际终点记录于 Melt Curve Result 的 Melt Terminal Fluorescence。它不是仪器的独立测量。',
    'Tm 是输入/模拟的峰位参数；Peak Temperature (sampled) 是导出采样网格中最大 Derivative 所在温度，两者并非相同定义。',
    '排除孔仍完整导出并标注 Excluded=true，但不进入分析统计。',
    '缺失 Cq 保持空白；扩增网格保留，信号列为空并标注状态。若 Tm 有效，独立的模拟熔解曲线仍可存在，不代表已检出扩增。',
    '没有复制真实样本记录、实验日期、仪器标识、校准参数、质量置信度或 x1-m1/x2-m2/x4-m4 等真实检测器通道。',
    'XLSX 压缩包包含分析工作簿和 raw/SIMULATED-RAW-Plate-N.xlsx；CSV 压缩包的逐板原始表位于 raw/Plate-N/。',
    '分板仅按已分配孔导出，不生成未分配空孔，也不静默截断任何原始数据。',
    '',
  ].join('\r\n')
}

export function createRawTables(project: QPCRProject, result: SimulationResult, plateIndex: number): RawTable[] {
  assertRawExportSize(project, result)
  const wells = result.wells.filter(well => well.plateIndex === plateIndex).sort((a, b) => positionNumber(a) - positionNumber(b))
  if (!wells.length) throw new Error(`Plate ${plateIndex + 1} 没有已分配孔。`)
  const groupNames = new Map(project.groups.map(group => [group.id, group.name]))
  const genes = new Map(project.genes.map(gene => [gene.id, gene]))
  const counts = sampleCounts(project)
  const tables: RawTable[] = [
    { sheet: 'Summary', filename: 'metadata.csv', columns: ['Field', 'Value', 'Data Type'], rows: [
      ['Data provenance', 'SIMULATED DATA / 模拟原始数据，仅供教学与方法验证', 'SIMULATED'],
      ['Project', project.name, 'SIMULATED'], ['Plate', plateIndex + 1, 'SIMULATED'], ['Assigned wells', wells.length, 'SIMULATED'],
      ['Schema version', 1, 'SIMULATED'], ['Simulation algorithm version', getSimulationAlgorithmVersion(project), 'SIMULATED'], ['Curve model', curveModel(project), 'SIMULATED'], ['Random seed', project.randomSeed, 'SIMULATED'],
      ['Amplification readings per well', counts.cycles, 'SIMULATED'], ['Melt readings per well', counts.meltReadings, 'SIMULATED'],
      ['Replicate design', project.replicateMode, 'SIMULATED'], ['Excluded wells', 'Exported with flag; excluded from analysis', 'SIMULATED'],
      ['Rn meaning', 'Synthetic fluorescence a.u.; NOT an instrument-calibrated reporter/reference ratio', 'SIMULATED'],
      ['Delta Rn baseline', `Mean of noisy synthetic Rn over configured cycles ${project.protocol.cqDetection.baselineStartCycle}–${project.protocol.cqDetection.baselineEndCycle}`, 'SIMULATED'],
      ['Melt Fluorescence', 'Backward trapezoid integral of exported Derivative. Default terminal = well baseline; negative values trigger a uniform upward offset. Actual terminal is in Melt Curve Result.', 'SIMULATED'],
      ['Melt Derivative', 'Exact displayed synthetic -dF/dT curve, a.u./°C', 'SIMULATED'],
      ['Tm definition', 'Input/simulated parameter; separate sampled peak temperature is not instrument-fitted Tm', 'SIMULATED'],
      ['Missing Cq', 'Blank Cq and amplification signal; independently simulated melt may remain when Tm is valid', 'SIMULATED'],
      ['Detector channels', 'Not exported: real x1-m1/x2-m2/x4-m4 calibration and detector data cannot be reconstructed', 'SIMULATED'],
      ['Compatibility', 'Reference-inspired table structure only; not a genuine instrument file or validated import format', 'SIMULATED'],
    ] },
    { sheet: 'Sample Setup', filename: 'sample-setup.csv', columns: RAW_COLUMNS.setup, rows: [] },
    { sheet: 'Amplification Data', filename: 'amplification.csv', columns: RAW_COLUMNS.amplification, rows: [] },
    { sheet: 'Melt Curve Raw Data', filename: 'melt-raw.csv', columns: RAW_COLUMNS.meltRaw, rows: [] },
    { sheet: 'Melt Curve Result', filename: 'melt-result.csv', columns: RAW_COLUMNS.meltResult, rows: [] },
    { sheet: 'Results', filename: 'results.csv', columns: RAW_COLUMNS.results, rows: [] },
  ]
  const [, setup, amplification, meltRaw, meltResult, results] = tables
  for (const well of wells) {
    const number = positionNumber(well)
    const group = groupNames.get(well.groupId) ?? well.groupId
    const gene = genes.get(well.geneId)
    const target = gene?.name ?? well.geneId
    const sample = `${group} / B${well.biologicalReplicate}`
    const status = cqStatus(well, project)
    setup.rows.push([number, well.wellId, sample, target, gene?.type ?? '', group, well.biologicalReplicate, well.technicalReplicate, well.excluded, 'SIMULATED', well.key])
    const amplitudePoints = rawAmplificationData(well, project)
    if (amplitudePoints.length && amplitudePoints.length !== counts.cycles) throw new Error(`${well.id} 扩增采样点不完整，导出已停止；未下载截断的数据。`)
    if (amplitudePoints.some(point => ![point.rn, point.deltaRn, point.baseline].every(Number.isFinite))) throw new Error(`${well.id} 扩增信号或基线不是有限数值，请修正设置后再导出。`)
    const byCycle = new Map(amplitudePoints.map(point => [point.cycle, point]))
    for (let cycle = 1; cycle <= counts.cycles; cycle++) {
      const point = byCycle.get(cycle)
      if (amplitudePoints.length && !point) throw new Error(`${well.id} 缺少 Cycle ${cycle}，导出已停止。`)
      amplification.rows.push([number, well.wellId, cycle, target, point ? finiteOrNull(point.rn) : null, point ? finiteOrNull(point.deltaRn) : null, point ? finiteOrNull(point.baseline) : null, sample, group, well.biologicalReplicate, well.technicalReplicate, finiteOrNull(well.values.cq), well.excluded, point ? 'synthetic signal available' : status === 'Cq available' ? 'signal unavailable' : status, 'SIMULATED', well.key])
    }
    const meltPoints = rawMeltingData(well, project)
    if (meltPoints.length && meltPoints.length !== counts.meltReadings) throw new Error(`${well.id} 熔解采样点不完整，导出已停止；未下载截断的数据。`)
    for (let index = 0; index < counts.meltReadings; index++) {
      const point = meltPoints[index]
      meltRaw.rows.push([number, well.wellId, point?.reading ?? index + 1, point?.temperature ?? Math.min(counts.end, counts.start + index / counts.density), point ? finiteOrNull(point.fluorescence) : null, point ? finiteOrNull(point.derivative) : null, target, sample, group, well.biologicalReplicate, well.technicalReplicate, status, well.excluded, point ? 'synthetic signal available' : 'signal unavailable', 'SIMULATED', well.key])
    }
    const peak = meltPoints.reduce<(typeof meltPoints)[number] | undefined>((highest, point) => Number.isFinite(point.derivative) && (!highest || point.derivative > highest.derivative) ? point : highest, undefined)
    meltResult.rows.push([number, well.wellId, sample, target, finiteOrNull(well.values.tm), peak ? peak.derivative : null, well.adjusted && project.manualOverrides[well.key]?.tm !== undefined ? 'manual Tm parameter' : 'simulated Tm parameter', peak ? peak.temperature : null, well.excluded, 'SIMULATED', well.key, meltPoints.length ? finiteOrNull(meltPoints[meltPoints.length - 1].fluorescence) : null])
    const source = status !== 'Cq available' ? status : project.manualOverrides[well.key]?.cq !== undefined ? 'manual Cq override' : project.inputMode === 'manual' ? 'manual Cq input' : 'simulated Cq parameter'
    results.rows.push([number, well.wellId, sample, target, finiteOrNull(well.values.cq), source, well.adjusted, well.excluded, well.qc.map(item => `${item.level}: ${item.message}`).join('; '), 'SIMULATED', well.key])
  }
  return tables
}
