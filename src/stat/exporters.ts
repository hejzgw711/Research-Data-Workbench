import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import type { Candidate, GenerationReport, GeneratorSettings, TimeSeriesCandidate, TimeSeriesGenerationReport, TimeSeriesGeneratorSettings } from './models'

function safeName(value: string) { return value.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'synthetic-data' }
function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url) }
function escapeCsv(value: unknown) { const text = value == null ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }
function csv(rows: unknown[][]) { return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}` }
function rawRows(candidate: Candidate, settings: GeneratorSettings) { const rows: unknown[][] = [['#', ...settings.groups.map((group) => group.name)]]; const length = Math.max(...candidate.values.map((values) => values.length)); for (let index = 0; index < length; index += 1) rows.push([index + 1, ...candidate.values.map((values) => values[index] ?? '')]); return rows }

function timeSeriesGroupedRows(candidate: TimeSeriesCandidate, settings: TimeSeriesGeneratorSettings) {
  const subjects = settings.groups[0]?.n ?? 0
  return [
    ['Time', ...settings.groups.flatMap((group) => Array.from({ length: subjects }, () => group.name))],
    ['', ...settings.groups.flatMap((group, groupIndex) => Array.from({ length: subjects }, (_, index) => `${String.fromCharCode(65 + groupIndex)}:${index + 1}`))],
    ...settings.timePoints.map((time, timeIndex) => [time.label, ...settings.groups.flatMap((_, groupIndex) => candidate.values[groupIndex]?.[timeIndex] ?? [])]),
  ] as unknown[][]
}

function timeSeriesLongRows(candidate: TimeSeriesCandidate, settings: TimeSeriesGeneratorSettings) {
  const rows: unknown[][] = [['Time value', 'Time label', 'Group', 'Subject', 'Value']]
  settings.timePoints.forEach((time, timeIndex) => settings.groups.forEach((group, groupIndex) => (candidate.values[groupIndex]?.[timeIndex] ?? []).forEach((value, subjectIndex) => rows.push([time.value, time.label, group.name, `${String.fromCharCode(65 + groupIndex)}:${subjectIndex + 1}`, value]))))
  return rows
}

export function saveProject(settings: GeneratorSettings, report: GenerationReport | null) {
  const payload = { schemaVersion: 1, application: 'Synthetic Data Studio', notice: 'SIMULATED / 合成模拟数据，不代表真实实验观测', settings, report }
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${safeName(settings.projectName)}.synthetic.json`)
}

export function exportCsv(candidate: Candidate, settings: GeneratorSettings) { downloadBlob(new Blob([csv(rawRows(candidate, settings))], { type: 'text/csv;charset=utf-8' }), `${safeName(settings.projectName)}_raw.csv`) }

export async function exportZip(report: GenerationReport) {
  const zip = new JSZip()
  zip.file('README.txt', 'SIMULATED / 合成模拟数据\r\n仅用于教学、绘图、统计方法验证和软件测试。\r\n不代表真实实验观测。\r\n')
  zip.file('settings.json', JSON.stringify(report.settings, null, 2))
  report.candidates.forEach((candidate, index) => { zip.file(`candidate_${index + 1}_raw.csv`, csv(rawRows(candidate, report.settings))); zip.file(`candidate_${index + 1}_statistics.json`, JSON.stringify({ test: candidate.test, summaries: candidate.summaries, checks: candidate.checks, seed: candidate.seed }, null, 2)) })
  downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safeName(report.settings.projectName)}_candidates.zip`)
}

export async function exportXlsx(report: GenerationReport, selected: Candidate) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'Synthetic Data Studio'; workbook.subject = 'SIMULATED TEACHING DATA'; workbook.created = new Date(0)
  const addSheet = (name: string, rows: unknown[][]) => { const sheet = workbook.addWorksheet(name); rows.forEach((row) => sheet.addRow(row)); sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF156B63' } }; sheet.columns.forEach((column) => { const lengths = (column.values ?? []).map((value) => String(value ?? '').length + 2); column.width = Math.min(42, Math.max(12, ...lengths)) }); return sheet }
  addSheet('README', [['字段', '内容'], ['声明', 'SIMULATED / 合成模拟数据，不代表真实实验观测'], ['用途', '仅用于教学、绘图、统计方法验证和软件测试'], ['项目', report.settings.projectName], ['Master seed', report.settings.seed], ['Candidate seed', selected.seed], ['随机抽样次数', report.attempts]])
  addSheet('Constraints', [['Parameter', 'Value'], ['Analysis design', report.settings.analysisDesign ?? 'single'], ['Trend', report.settings.trend], ['Data type', report.settings.dataType], ['Decimals', report.settings.decimals === null ? 'Unrestricted' : report.settings.decimals], ['Distribution', report.settings.distribution], ['Irregularity', report.settings.irregularity], ['Batch n', report.settings.batchN ?? 8], ['Batch minimum', report.settings.batchMinValue ?? 0], ['Batch maximum', report.settings.batchMaxValue ?? 'Unrestricted'], ['Method', report.settings.method], ['Tail', report.settings.tail], ['Seed mode', report.settings.seedMode], ['Seed', report.settings.seed], ['Max attempts', report.settings.maxAttempts]])
  addSheet('Groups', [['Group ID', 'Name', 'n', 'Target mean', 'Minimum', 'Maximum', 'Target SD', 'Color'], ...report.settings.groups.map((group) => [group.id, group.name, group.n, group.targetMean, group.minValue, group.maxValue, group.targetSd, group.color])])
  addSheet('Pairwise_Constraints', [['Left group', 'Right group', 'Constrained', 'p minimum', 'p maximum'], ...report.settings.pairwiseConstraints.map((constraint) => [report.settings.groups.find((group) => group.id === constraint.leftGroupId)?.name ?? constraint.leftGroupId, report.settings.groups.find((group) => group.id === constraint.rightGroupId)?.name ?? constraint.rightGroupId, constraint.enabled !== false ? 'Yes' : 'No', constraint.pMin, constraint.pMax])])
  addSheet('Raw_Data', rawRows(selected, report.settings))
  addSheet('Summary', [['Group', 'n', 'Mean', 'SD', 'SEM', '95% CI low', '95% CI high'], ...selected.summaries.map((summary) => [summary.name, summary.n, summary.mean, summary.sd, summary.sem, summary.ciLow, summary.ciHigh])])
  addSheet('Test_Result', [['Field', 'Value'], ['Method', selected.test.method], ['Statistic', selected.test.statistic], ['df', selected.test.method === 'anova' ? `${selected.test.dfBetween},${selected.test.dfWithin}` : selected.test.degreesOfFreedom], ['P value', selected.test.pValue], ['Effect size', selected.test.effectSize], ['Status', selected.status]])
  if (selected.test.pairwise) addSheet('Pairwise_FDR', [['Left', 'Right', 'p', 'BH-FDR', 'Label'], ...selected.test.pairwise.map((pair) => [pair.leftGroupName, pair.rightGroupName, pair.pValue, pair.adjustedPValue, pair.label])])
  if (selected.test.twoWay && report.settings.twoWay) addSheet('TwoWay_ANOVA', [['Effect', 'df', 'SS', 'MS', 'F', 'p', 'Partial eta squared'], ...[selected.test.twoWay.factorA, selected.test.twoWay.factorB, selected.test.twoWay.interaction].map((effect) => [effect.name, effect.degreesOfFreedom, effect.sumOfSquares, effect.meanSquare, effect.statistic, effect.pValue, effect.effectSize]), ['Residual', selected.test.twoWay.residualDegreesOfFreedom, '', '', '', '', '']])
  addSheet('Validation', [['Constraint', 'Status', 'Detail'], ...selected.checks.map((check) => [check.label, check.status, check.detail])])
  addSheet('Generation_Log', [['Field', 'Value'], ['Started', report.startedAt], ['Completed', report.completedAt], ['Attempts', report.attempts], ['Message', report.message]])
  const buffer = await workbook.xlsx.writeBuffer(); downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(report.settings.projectName)}.xlsx`)
}

export async function copyPrismColumns(candidate: Candidate, settings: GeneratorSettings) { await navigator.clipboard.writeText(rawRows(candidate, settings).map((row) => row.slice(1).join('\t')).slice(0).join('\n')) }

export async function copyPrismGrouped(candidate: Candidate, settings: GeneratorSettings) {
  const twoWay = settings.twoWay
  if (!twoWay) return copyPrismColumns(candidate, settings)
  const replicates = twoWay.cells[0]?.n ?? 0
  const rows: string[][] = []
  rows.push(['', ...twoWay.factorA.levels.flatMap((level) => Array.from({ length: replicates }, () => level))])
  rows.push(['', ...twoWay.factorA.levels.flatMap(() => Array.from({ length: replicates }, (_, index) => String(index + 1)))])
  twoWay.factorB.levels.forEach((levelB, factorBIndex) => {
    const values = twoWay.factorA.levels.flatMap((_, factorAIndex) => {
      const cellIndex = twoWay.cells.findIndex((cell) => cell.factorAIndex === factorAIndex && cell.factorBIndex === factorBIndex)
      return candidate.values[cellIndex] ?? []
    })
    rows.push([levelB, ...values.map(String)])
  })
  await navigator.clipboard.writeText(rows.map((row) => row.join('\t')).join('\n'))
}

export function saveTimeSeriesProject(settings: TimeSeriesGeneratorSettings, report: TimeSeriesGenerationReport | null) {
  const payload = { schemaVersion: 1, application: 'Synthetic Data Studio', design: 'repeated-measures-time-series', notice: 'SIMULATED / 合成模拟数据，不代表真实实验观测', settings, report }
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${safeName(settings.chartTitle)}_time-series.synthetic.json`)
}

export function exportTimeSeriesCsv(candidate: TimeSeriesCandidate, settings: TimeSeriesGeneratorSettings) {
  downloadBlob(new Blob([csv(timeSeriesGroupedRows(candidate, settings))], { type: 'text/csv;charset=utf-8' }), `${safeName(settings.chartTitle)}_time-series_grouped.csv`)
}

export async function exportTimeSeriesZip(report: TimeSeriesGenerationReport) {
  const zip = new JSZip()
  zip.file('README.txt', 'SIMULATED / 合成模拟数据\r\n重复测量时间序列；仅用于教学、绘图和方法验证。\r\n')
  zip.file('settings.json', JSON.stringify(report.settings, null, 2))
  report.candidates.forEach((candidate, index) => { zip.file(`candidate_${index + 1}_grouped.csv`, csv(timeSeriesGroupedRows(candidate, report.settings))); zip.file(`candidate_${index + 1}_long.csv`, csv(timeSeriesLongRows(candidate, report.settings))); zip.file(`candidate_${index + 1}_statistics.json`, JSON.stringify({ test: candidate.test, summaries: candidate.summaries, seed: candidate.seed }, null, 2)) })
  downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safeName(report.settings.chartTitle)}_time-series_candidates.zip`)
}

export async function exportTimeSeriesXlsx(report: TimeSeriesGenerationReport, selected: TimeSeriesCandidate) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'Synthetic Data Studio'; workbook.subject = 'SIMULATED LONGITUDINAL TEACHING DATA'; workbook.created = new Date(0)
  const addSheet = (name: string, rows: unknown[][]) => { const sheet = workbook.addWorksheet(name); rows.forEach((row) => sheet.addRow(row)); sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF156B63' } }; sheet.columns.forEach((column) => { const lengths = (column.values ?? []).map((value) => String(value ?? '').length + 2); column.width = Math.min(42, Math.max(12, ...lengths)) }); return sheet }
  addSheet('README', [['字段', '内容'], ['声明', 'SIMULATED / 合成模拟数据，不代表真实实验观测'], ['设计', '同一批动物重复测量；组别 × 时间重复测量 two-way ANOVA'], ['项目', report.settings.chartTitle], ['Master seed', report.settings.seed], ['Candidate seed', selected.seed]])
  addSheet('Grouped_Input', timeSeriesGroupedRows(selected, report.settings))
  addSheet('Raw_Long', timeSeriesLongRows(selected, report.settings))
  addSheet('Summary', [['Time', 'Group', 'n', 'Mean', 'SD', 'SEM', '95% CI low', '95% CI high'], ...selected.summaries.map((summary) => [summary.timeLabel, summary.groupName, summary.n, summary.mean, summary.sd, summary.sem, summary.ciLow, summary.ciHigh])])
  addSheet('Repeated_ANOVA', [['Effect', 'df', 'SS', 'MS', 'F', 'p', 'Partial eta squared'], ...[selected.test.twoWay.group, selected.test.twoWay.time, selected.test.twoWay.interaction].map((effect) => [effect.name, effect.degreesOfFreedom, effect.sumOfSquares, effect.meanSquare, effect.statistic, effect.pValue, effect.effectSize]), ['Subject residual', selected.test.twoWay.subjectResidualDegreesOfFreedom], ['Time residual', selected.test.twoWay.residualDegreesOfFreedom]])
  addSheet('Pairwise_Holm', [['Time', 'Left', 'Right', 'p', 'Label'], ...selected.test.pairwise.map((pair) => [pair.timeLabel, pair.leftGroupName, pair.rightGroupName, pair.pValue, pair.label])])
  const buffer = await workbook.xlsx.writeBuffer(); downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(report.settings.chartTitle)}_time-series.xlsx`)
}
