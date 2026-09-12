import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import type { QPCRProject, SimulationResult, PCRStep, CurvePoint } from '../../models'
import { amplificationCurve, meltingCurve } from '../../domain/qpcr'
import { getSimulationAlgorithmVersion } from '../project'
import { assertRawExportSize, createRawTables, rawPlateIndexes, rawReadme } from './raw'

type Cell = string | number | boolean | null
interface ExportTable { sheet: string; filename: string; columns: string[]; rows: Cell[][] }
const SIMULATION_NOTE = 'SIMULATED DATA / 模拟数据，仅供教学与方法验证，不代表真实实验测量'
const MAX_RAW_CURVE_CELLS = 500000

export function downloadBlob(content: Blob | string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'qpcr-project'
}

/** Text cells remain text even when opened by Excel. Numeric negative values are untouched. */
function safeText(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value
}

function csvCell(value: Cell): string {
  const text = value === null || (typeof value === 'number' && !Number.isFinite(value)) ? '' : typeof value === 'string' ? safeText(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function encodeCsv(table: ExportTable): string {
  return '\ufeff' + [table.columns, ...table.rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

function protocolRows(project: QPCRProject): Cell[][] {
  const p = project.protocol
  const rows: Cell[][] = []
  const addStep = (name: string, step: PCRStep, cycles = 1, enabled = true) => {
    rows.push([name, 'temperature', step.temperatureC, '°C', step.acquisition, cycles, enabled])
    rows.push([name, 'hold', step.holdSeconds, 's', step.acquisition, cycles, enabled])
    rows.push([name, 'ramp rate', step.rampRateCPerSec, '°C/s', step.acquisition, cycles, enabled])
  }
  addStep('Preincubation', p.preincubation)
  addStep('Denaturation', p.denaturation, p.cycles)
  addStep('Annealing', p.annealing, p.cycles)
  addStep('Extension', p.extension, p.cycles, p.mode === 'three-step')
  addStep('Melt high', p.meltHigh)
  addStep('Melt low', p.meltLow)
  addStep('Melt end', p.meltEnd)
  addStep('Cooling', p.cooling, 1, p.coolingEnabled)
  const settings: [string, Cell, string][] = [
    ['mode', p.mode, ''], ['cycles', p.cycles, 'cycles'], ['channel', p.channel, ''],
    ['reaction volume', p.volume, 'µL'], ['readings per °C', p.readingsPerC, 'readings/°C'],
    ['quantification factor', p.quantFactor, ''], ['melt factor', p.meltFactor, ''],
    ['acquisition mode', p.acquisitionMode, ''], ['Cq detection mode', p.cqDetection.mode, ''],
    ['Cq threshold', p.cqDetection.threshold, 'a.u.'],
    ['baseline start', p.cqDetection.baselineStartCycle, 'cycle'], ['baseline end', p.cqDetection.baselineEndCycle, 'cycle'],
  ]
  settings.forEach(([parameter, value, unit]) => rows.push(['Settings', parameter, value, unit, '', '', true]))
  return rows
}

/** Both formats are built from the same result snapshot; exports never rerun the analysis. */
function createTables(project: QPCRProject, result: SimulationResult): ExportTable[] {
  const groups = new Map(project.groups.map(group => [group.id, group.name]))
  const genes = new Map(project.genes.map(gene => [gene.id, gene.name]))
  const estimatedRawCells = result.wells.length * (project.protocol.cycles + 1 + Math.ceil((project.protocol.meltEnd.temperatureC - project.protocol.meltLow.temperatureC) * project.protocol.readingsPerC) + 1)
  const includeCurves = estimatedRawCells <= MAX_RAW_CURVE_CELLS
  const tables: ExportTable[] = [
    { sheet: 'Summary', filename: 'metadata.csv', columns: ['Field', 'Value'], rows: [
      ['Data provenance', SIMULATION_NOTE], ['Project', project.name], ['Project ID', project.id],
      ['Schema version', 1], ['Simulation algorithm version', getSimulationAlgorithmVersion(project)], ['Curve model', project.simulation.curveModel ?? 'legacy-v1'], ['Random seed', project.randomSeed],
      ['Replicate design', project.replicateMode], ['Input mode', project.inputMode],
      ['Statistical unit', project.replicateMode === 'biological' ? 'Biological sample; technical Cq values aggregated before inference' : 'Technical-repeat preview; non-inferential'],
      ['Statistical test', 'Two-sided Welch t-test on ΔCq'], ['Multiple comparison adjustment', project.simulation.correction],
      ['Correction family', 'Configured pairwise comparisons within each target gene'],
      ['Normalization', 'Fold change = 2^(-ΔΔCq); calibrator geometric mean = 1'],
      ['Total assigned wells', result.totalWells], ['Plate count', result.plateCount],
      ['QC status', result.qc.some(item => item.level === 'fail') ? 'FAIL' : result.qc.some(item => item.level === 'warning') ? 'WARNING' : 'PASS'],
      ['Raw curve tables', includeCurves ? 'Included; fluorescence/peak are synthetic values. Complete reference-style tables are also in raw/.' : 'Wide analysis curve tables omitted above 500,000 values; complete per-plate raw tables accompany this data-export ZIP in raw/.'],
    ] },
    { sheet: 'Groups', filename: 'groups.csv', columns: ['Group ID', 'Group', 'Calibrator', 'Biological replicates configured', 'Technical replicates', 'Technical Cq SD', 'Target ID', 'Target', 'Nominal fold', 'Fold SD mode', 'Fold SD'], rows:
      project.groups.flatMap(group => Object.entries(group.targetFoldByGene).map(([geneId, config]) => [group.id, group.name, group.isCalibrator, group.biologicalReplicates, group.technicalReplicates, group.technicalCqSD, geneId, genes.get(geneId) ?? geneId, config.mean, config.sdMode, config.sd])) },
    { sheet: 'Genes', filename: 'genes.csv', columns: ['Gene ID', 'Gene', 'Role', 'Nominal Cq', 'Expected Tm (°C)', 'Primer concentration (µM)', 'Melt FWHM (°C)'], rows:
      project.genes.map(gene => [gene.id, gene.name, gene.type, gene.nominalCq, gene.tmC, gene.primerConcentration, gene.meltFwhmC]) },
    { sheet: 'Raw Cq', filename: 'cq.csv', columns: ['Well ID', 'Plate', 'Position', 'Stable key', 'Group', 'Gene', 'Sample ID', 'Biological replicate', 'Technical replicate', 'Cq', 'Generated Cq', 'Excluded', 'Adjusted', 'Data type'], rows:
      result.wells.map(well => [well.id, well.plateIndex + 1, well.wellId, well.key, groups.get(well.groupId) ?? well.groupId, genes.get(well.geneId) ?? well.geneId, well.sampleId, well.biologicalReplicate, well.technicalReplicate, well.values.cq, well.generated.cq, well.excluded, well.adjusted, 'SIMULATED']) },
    { sheet: 'ΔCq', filename: 'delta-cq.csv', columns: ['Sample ID', 'Group', 'Target', 'Replicate', 'Reference Cq', 'Target Cq', 'ΔCq', 'Technical N', 'Inferential'], rows:
      result.samples.map(sample => [sample.id, groups.get(sample.groupId) ?? sample.groupId, genes.get(sample.geneId) ?? sample.geneId, sample.replicate, sample.referenceCq, sample.targetCq, sample.deltaCq, sample.technicalN, sample.inferential]) },
    { sheet: 'ΔΔCq', filename: 'delta-delta-cq.csv', columns: ['Sample ID', 'Group', 'Target', 'Replicate', 'ΔCq', 'ΔΔCq', 'Inferential'], rows:
      result.samples.map(sample => [sample.id, groups.get(sample.groupId) ?? sample.groupId, genes.get(sample.geneId) ?? sample.geneId, sample.replicate, sample.deltaCq, sample.deltaDeltaCq, sample.inferential]) },
    { sheet: 'Fold Change', filename: 'fold-change.csv', columns: ['Sample ID', 'Group', 'Target', 'Replicate', 'Fold change', 'Inferential', 'Data type'], rows:
      result.samples.map(sample => [sample.id, groups.get(sample.groupId) ?? sample.groupId, genes.get(sample.geneId) ?? sample.geneId, sample.replicate, sample.fold, sample.inferential, 'SIMULATED']) },
    { sheet: 'Group Summary', filename: 'group-summary.csv', columns: ['Group', 'Target', 'Sample N', 'Arithmetic mean fold', 'Sample SD fold', 'Geometric mean fold', 'SD of sample-aggregated target Cq', 'Inferential'], rows:
      result.groups.map(group => [groups.get(group.groupId) ?? group.groupId, genes.get(group.geneId) ?? group.geneId, group.n, group.mean, group.sd, group.geometricMean, group.cqSD, project.replicateMode === 'biological']) },
    { sheet: 'Statistics', filename: 'statistics.csv', columns: ['Comparison ID', 'Target', 'Left group', 'Right group', 'Welch t', 'Degrees of freedom', 'Raw P', 'Reported P', 'Adjustment', 'Significance', 'Inferential', 'Status', 'Reason'], rows:
      result.comparisons.map(comparison => [comparison.id, genes.get(comparison.geneId) ?? comparison.geneId, groups.get(comparison.leftGroupId) ?? comparison.leftGroupId, groups.get(comparison.rightGroupId) ?? comparison.rightGroupId, comparison.statistic, comparison.df, comparison.rawP, comparison.p, project.simulation.correction, comparison.label, comparison.inferential, comparison.status, comparison.reason ?? '']) },
    { sheet: 'Plate Layout', filename: 'wells.csv', columns: ['Well ID', 'Plate', 'Row', 'Column', 'Position', 'Stable key', 'Group', 'Gene', 'Biological replicate', 'Technical replicate', 'Cq', 'Tm (°C)', 'Plateau', 'Slope', 'Noise', 'Baseline', 'FWHM (°C)', 'Excluded', 'Adjusted', 'QC'], rows:
      result.wells.map(well => [well.id, well.plateIndex + 1, well.row, well.column, well.wellId, well.key, groups.get(well.groupId) ?? well.groupId, genes.get(well.geneId) ?? well.geneId, well.biologicalReplicate, well.technicalReplicate, well.values.cq, well.values.tm, well.values.plateau, well.values.slope, well.values.noise, well.values.baseline, well.values.fwhm, well.excluded, well.adjusted, well.qc.map(item => `${item.level}: ${item.message}`).join('; ')]) },
    { sheet: 'PCR Protocol', filename: 'protocol.csv', columns: ['Stage', 'Parameter', 'Value', 'Unit', 'Acquisition', 'Cycles', 'Enabled'], rows: protocolRows(project) },
    { sheet: 'QC', filename: 'qc.csv', columns: ['Rule ID', 'Level', 'Message', 'Wells', 'Samples'], rows:
      result.qc.map(item => [item.id, item.level, item.message, item.wellIds?.join('; ') ?? '', item.sampleIds?.join('; ') ?? '']) },
  ]
  if (includeCurves && result.wells.length) {
    // An excluded/missing first well may have no curve; it must not erase the other wells' column headings.
    let amplificationPoints: CurvePoint[] = []
    let meltPoints: CurvePoint[] = []
    for (const well of result.wells) {
      if (!amplificationPoints.length) amplificationPoints = amplificationCurve(well, project)
      if (!meltPoints.length) meltPoints = meltingCurve(well, project)
      if (amplificationPoints.length && meltPoints.length) break
    }
    tables.push({ sheet: 'Raw Fluorescence', filename: 'raw-fluorescence.csv', columns: ['Well ID', 'Plate', 'Position', 'Data type', ...amplificationPoints.map(point => `Cycle ${point.x}`)], rows:
      result.wells.map(well => {
        const points = amplificationCurve(well, project)
        return [well.id, well.plateIndex + 1, well.wellId, 'SIMULATED', ...amplificationPoints.map((_, i) => points[i]?.y ?? null)]
      }) })
    tables.push({ sheet: 'Melt Data', filename: 'melt-data.csv', columns: ['Well ID', 'Plate', 'Position', 'Data type', ...meltPoints.map(point => `${point.x} °C`) ], rows:
      result.wells.map(well => {
        const points = meltingCurve(well, project)
        return [well.id, well.plateIndex + 1, well.wellId, 'SIMULATED -dF/dT', ...meltPoints.map((_, i) => points[i]?.y ?? null)]
      }) })
  }
  return tables
}

function workbookFromTables(project: QPCRProject, tables: ExportTable[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'qRT-PCR Data Studio'
  workbook.subject = SIMULATION_NOTE
  workbook.title = project.name
  // Stable metadata avoids wall-clock timestamps becoming part of the simulated experiment.
  workbook.created = new Date('2026-01-01T00:00:00Z')
  workbook.modified = new Date('2026-01-01T00:00:00Z')
  for (const table of tables) {
    const sheet = workbook.addWorksheet(table.sheet)
    sheet.addRow(table.columns)
    table.rows.forEach(row => sheet.addRow(row.map(value => typeof value === 'number' && !Number.isFinite(value) ? null : value)))
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF247C71' } }
    sheet.getRow(1).height = 26
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.headerFooter.oddHeader = '&CSIMULATED DATA / 模拟数据'
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.columns.length } }
    sheet.columns.forEach((column, index) => { column.width = Math.min(42, Math.max(16, table.columns[index].length + 3)) })
    if (table.sheet === 'Summary') { sheet.getColumn(1).width = 34; sheet.getColumn(2).width = 110 }
  }
  return workbook
}

export function createWorkbook(project: QPCRProject, result: SimulationResult): ExcelJS.Workbook {
  return workbookFromTables(project, createTables(project, result))
}

export function createRawWorkbook(project: QPCRProject, result: SimulationResult, plateIndex: number): ExcelJS.Workbook {
  const workbook = workbookFromTables(project, createRawTables(project, result, plateIndex))
  const summary = workbook.getWorksheet('Summary')!
  summary.getColumn(1).alignment = { wrapText: true, vertical: 'top' }
  summary.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
  summary.eachRow((row, index) => {
    if (index === 1) return
    const displayLength = String(row.getCell(2).value ?? '').replace(/[^\x00-\xff]/g, 'aa').length
    row.height = Math.max(32, Math.ceil(displayLength / 100) * 16 + 8)
  })
  return workbook
}

export function createCsvFiles(project: QPCRProject, result: SimulationResult): Record<string, string> {
  assertRawExportSize(project, result)
  const files = Object.fromEntries(createTables(project, result).map(table => [table.filename, encodeCsv(table)]))
  files['README-SIMULATED.txt'] = rawReadme(project)
  for (const plateIndex of rawPlateIndexes(result)) {
    for (const table of createRawTables(project, result, plateIndex)) files[`raw/Plate-${plateIndex + 1}/${table.filename}`] = encodeCsv(table)
  }
  return files
}

export async function createXlsxBundle(project: QPCRProject, result: SimulationResult): Promise<JSZip> {
  assertRawExportSize(project, result)
  const zip = new JSZip()
  const options = { date: new Date('2026-01-01T00:00:00Z'), compression: 'STORE' as const }
  zip.file('README-SIMULATED.txt', rawReadme(project), options)
  {
    const buffer = await createWorkbook(project, result).xlsx.writeBuffer()
    zip.file(`${safeFilename(project.name)}-SIMULATED.xlsx`, new Uint8Array(buffer), options)
  }
  // One workbook at a time: keep serialized XLSX bytes rather than every plate's cell objects alive.
  for (const plateIndex of rawPlateIndexes(result)) {
    const buffer = await createRawWorkbook(project, result, plateIndex).xlsx.writeBuffer()
    zip.file(`raw/SIMULATED-RAW-Plate-${plateIndex + 1}.xlsx`, new Uint8Array(buffer), options)
  }
  return zip
}

export async function exportXlsx(project: QPCRProject, result: SimulationResult): Promise<void> {
  const zip = await createXlsxBundle(project, result)
  downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safeFilename(project.name)}-SIMULATED-XLSX-RAW.zip`)
}

export async function exportCsvZip(project: QPCRProject, result: SimulationResult): Promise<void> {
  const zip = new JSZip()
  for (const [filename, content] of Object.entries(createCsvFiles(project, result))) zip.file(filename, content, { date: new Date('2026-01-01T00:00:00Z') })
  downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${safeFilename(project.name)}-SIMULATED-CSV.zip`)
}

export function summaryTSV(project: QPCRProject, result: SimulationResult, geneId: string): string {
  const summaries = result.groups.filter(group => group.geneId === geneId)
  const replicateCount = Math.max(0, ...project.groups.map(group => project.replicateMode === 'biological' ? group.biologicalReplicates : group.technicalReplicates))
  const groupNames = new Map(project.groups.map(group => [group.id, group.name]))
  const geneName = project.genes.find(gene => gene.id === geneId)?.name ?? geneId
  const rows: Cell[][] = [
    [SIMULATION_NOTE], ['Gene', geneName], ['Statistical unit', project.replicateMode === 'biological' ? 'Biological sample' : 'Technical preview — non-inferential'],
    ['Group', ...Array.from({ length: replicateCount }, (_, i) => `R${i + 1}`), 'Mean', 'SD', 'Geometric mean', 'N'],
    ...summaries.map(group => {
      const byReplicate = new Map(result.samples.filter(sample => sample.groupId === group.groupId && sample.geneId === geneId).map(sample => [sample.replicate, sample.fold]))
      return [groupNames.get(group.groupId) ?? group.groupId, ...Array.from({ length: replicateCount }, (_, i) => byReplicate.get(i + 1) ?? null), group.mean, group.sd, group.geometricMean, group.n]
    }),
  ]
  return rows.map(row => row.map(value => typeof value === 'string' ? safeText(value).replace(/[\t\r\n]+/g, ' ') : value === null || typeof value === 'number' && !Number.isFinite(value) ? '' : String(value)).join('\t')).join('\r\n')
}
