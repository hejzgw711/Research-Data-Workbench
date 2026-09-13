import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneSettings, defaultSettings, generateCandidates } from './core/generator'
import { defaultTimeSeriesSettings, generateTimeSeriesCandidates } from './core/timeSeries'
import { chartPngDataUrl, copyPrismColumns, exportCsv, exportTimeSeriesCsv, exportTimeSeriesXlsx, exportTimeSeriesZip, exportXlsx, exportZip, safeName, saveProject, saveTimeSeriesProject } from './exporters'

const settings = cloneSettings(defaultSettings)
settings.seedMode = 'locked'
settings.seed = 'export-regression'
settings.maxAttempts = 30
settings.pairwiseConstraints.forEach((constraint) => { constraint.enabled = false })
const report = generateCandidates(settings, 1)
const selected = report.candidates[0]
const timeSettings = structuredClone(defaultTimeSeriesSettings)
timeSettings.seedMode = 'locked'
timeSettings.seed = 'time-export-regression'
const timeReport = generateTimeSeriesCandidates(timeSettings, 1)
const timeSelected = timeReport.candidates[0]

let downloaded: { blob: Blob; filename: string }
beforeEach(() => {
  let blob: Blob
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => { blob = value as Blob; return 'blob:export-test' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click() { downloaded = { blob, filename: this.download } } }) })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function downloadedWorkbook() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await downloaded.blob.arrayBuffer())
  return workbook
}

describe('neutral teaching exports', () => {
  it('keeps exact values in ordinary XLSX and opens the data sheet without automatic labels', async () => {
    await exportXlsx(report, selected)
    const workbook = await downloadedWorkbook()
    expect(downloaded.filename).toBe('分组约束数据.xlsx')
    expect(workbook.worksheets[0].name).toBe('Raw_Data')
    expect(workbook.creator).toBe('Research Data Workbench')
    expect(workbook.subject).not.toMatch(/simulated|synthetic|模拟/i)
    for (const sheet of workbook.worksheets) {
      expect(JSON.stringify(sheet.getSheetValues())).not.toMatch(/simulated|synthetic|模拟/i)
      expect(sheet.state).toBe('visible')
    }
    selected.values.forEach((values, groupIndex) => values.forEach((value, rowIndex) => {
      expect(workbook.getWorksheet('Raw_Data')!.getCell(rowIndex + 2, groupIndex + 2).value).toBe(value)
    }))
  })

  it('keeps grouped time-series values and identities without adding export labels', async () => {
    await exportTimeSeriesXlsx(timeReport, timeSelected)
    const workbook = await downloadedWorkbook()
    expect(workbook.worksheets[0].name).toBe('Grouped_Input')
    expect(workbook.subject).not.toMatch(/simulated|synthetic|模拟/i)
    workbook.worksheets.forEach((sheet) => expect(JSON.stringify(sheet.getSheetValues())).not.toMatch(/simulated|synthetic|模拟/i))
    const grouped = workbook.getWorksheet('Grouped_Input')!
    timeSelected.values.forEach((group, groupIndex) => group.forEach((values, timeIndex) => values.forEach((value, subjectIndex) => {
      const column = groupIndex * timeSettings.groups[0].n + subjectIndex + 2
      expect(grouped.getCell(2, column).value).toBe(`${String.fromCharCode(65 + groupIndex)}:${subjectIndex + 1}`)
      expect(grouped.getCell(timeIndex + 3, column).value).toBe(value)
    })))
  })

  it('keeps neutral CSV, ZIP and clipboard tables unchanged', async () => {
    exportCsv(selected, settings)
    const rawCsv = await downloaded.blob.text()
    expect(rawCsv).toContain('#,')
    expect(rawCsv).toContain(selected.values[0][0].toString())
    await exportZip(report)
    const zip = await JSZip.loadAsync(await downloaded.blob.arrayBuffer())
    expect(await zip.file('README.txt')!.async('string')).not.toMatch(/simulated|synthetic|模拟/i)
    expect(JSON.parse(await zip.file('settings.json')!.async('string'))).toEqual({ ...report.settings, projectName: '分组约束数据' })
    expect((await zip.file('candidate_1_raw.csv')!.async('string')).replace(/^\uFEFF/, '')).toBe(rawCsv.replace(/^\uFEFF/, ''))
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    vi.stubGlobal('navigator', { clipboard })
    await copyPrismColumns(selected, settings)
    expect(clipboard.writeText).toHaveBeenCalledWith([
      settings.groups.map((group) => group.name).join('\t'),
      ...Array.from({ length: selected.values[0].length }, (_, row) => selected.values.map((values) => values[row]).join('\t')),
    ].join('\n'))

    exportTimeSeriesCsv(timeSelected, timeSettings)
    const timeCsv = await downloaded.blob.text()
    await exportTimeSeriesZip(timeReport)
    const timeZip = await JSZip.loadAsync(await downloaded.blob.arrayBuffer())
    expect(await timeZip.file('README.txt')!.async('string')).not.toMatch(/simulated|synthetic|模拟/i)
    expect((await timeZip.file('candidate_1_grouped.csv')!.async('string')).replace(/^\uFEFF/, '')).toBe(timeCsv.replace(/^\uFEFF/, ''))
  })

  it('preserves reusable project settings, schema and results without an added notice', async () => {
    saveProject(settings, report)
    const project = JSON.parse(await downloaded.blob.text())
    expect(downloaded.filename).toBe('分组约束数据.json')
    expect(project).toEqual({ schemaVersion: 1, application: 'Research Data Workbench', settings: { ...settings, projectName: '分组约束数据' }, report: { ...report, settings: { ...report.settings, projectName: '分组约束数据' } } })
    expect(settings.projectName).toBe('分组约束随机模拟')
    expect(report.settings.projectName).toBe('分组约束随机模拟')
    const originalMessage = timeReport.message
    saveTimeSeriesProject(timeSettings, timeReport)
    const timeProject = JSON.parse(await downloaded.blob.text())
    expect(timeProject.notice).toBeUndefined()
    expect(timeProject.design).toBe('repeated-measures-time-series')
    expect(timeProject.settings).toEqual(timeSettings)
    expect(timeProject.report.candidates).toEqual(timeReport.candidates)
    expect(timeProject.report.message).not.toContain('模拟')
    expect(timeReport.message).toBe(originalMessage)
  })

  it('does not scrub user-defined project or group names', async () => {
    expect(safeName('我的模拟课程')).toBe('我的模拟课程')
    const custom = structuredClone(report)
    custom.settings.projectName = '我的模拟课程'
    custom.settings.groups[0].name = 'SIMULATED control (user label)'
    await exportXlsx(custom, selected)
    const workbook = await downloadedWorkbook()
    expect(downloaded.filename).toBe('我的模拟课程.xlsx')
    expect(workbook.getWorksheet('Raw_Data')!.getCell('B1').value).toBe('SIMULATED control (user label)')
    expect(workbook.getWorksheet('README')!.getCell('B3').value).toBe('我的模拟课程')
    saveProject(custom.settings, custom)
    expect(JSON.parse(await downloaded.blob.text())).toEqual({ schemaVersion: 1, application: 'Research Data Workbench', settings: custom.settings, report: custom })
  })

  it('uses a neutral system axis only during PNG export and always restores the preview', () => {
    let axisName = 'Synthetic value'
    const chart: Parameters<typeof chartPngDataUrl>[0] = {
      getOption: () => ({ yAxis: [{ name: axisName }] }),
      setOption: vi.fn((option) => { axisName = (option.yAxis as Array<{ name: string }>)[0].name }),
      getDataURL: vi.fn(() => `data:image/png;axis=${axisName}`),
    }
    expect(chartPngDataUrl(chart, true)).toBe('data:image/png;axis=Value')
    expect(axisName).toBe('Synthetic value')
    expect(chartPngDataUrl(chart, false)).toBe('data:image/png;axis=Synthetic value')
    chart.getDataURL = () => { throw new Error('export failed') }
    expect(() => chartPngDataUrl(chart, true)).toThrow('export failed')
    expect(axisName).toBe('Synthetic value')
  })
})
