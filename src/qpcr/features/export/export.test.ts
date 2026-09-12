import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { createDefaultProject } from '../../defaults'
import type { SimulationResult, Well, WellValues } from '../../models'
import { rawAmplificationData, rawMeltingData } from '../../domain/qpcr'
import { createCsvFiles, createRawWorkbook, createWorkbook, createXlsxBundle, summaryTSV } from './index'
import { assertRawExportSize, RAW_COLUMNS } from './raw'

function fixture(): SimulationResult {
  const values: WellValues = { cq: 18.125, tm: 85.8, plateau: 1.5, slope: 0.8, noise: 0.004, baseline: 0.01, fwhm: 2.53 }
  const well: Well = { id: '1/A1', key: 'g1/1/ref1/1', wellId: 'A1', plateIndex: 0, row: 'A', column: 1, groupId: 'g1', geneId: 'ref1', sampleId: 'g1/1', biologicalReplicate: 1, technicalReplicate: 1, generated: values, values, excluded: false, adjusted: false, qc: [] }
  return {
    wells: [well], totalWells: 1, plateCount: 1, qc: [],
    samples: [{ id: 'g1/1/target1', groupId: 'g1', geneId: 'target1', replicate: 1, referenceCq: 18.125, targetCq: 24.25, deltaCq: 6.125, deltaDeltaCq: 0, fold: 1, technicalN: 3, inferential: true }],
    groups: [{ groupId: 'g1', geneId: 'target1', n: 1, mean: 1, sd: 0, geometricMean: 1, folds: [1], deltaCqs: [6.125], cqSD: 0.125 }],
    comparisons: [{ id: 'c2', geneId: 'target1', leftGroupId: 'g1', rightGroupId: 'g2', rawP: 0.0123, p: 0.0369, statistic: -4.52, df: 3.92, label: '*', inferential: true, status: 'ok' }],
  }
}

describe('export builders', () => {
  it('writes a readable workbook with required sheets, simulation metadata and numeric cells', async () => {
    const project = createDefaultProject()
    const source = createWorkbook(project, fixture())
    const buffer = await source.xlsx.writeBuffer()
    const restored = new ExcelJS.Workbook()
    await restored.xlsx.load(buffer)
    for (const name of ['Summary', 'Groups', 'Genes', 'Raw Cq', 'ΔCq', 'ΔΔCq', 'Fold Change', 'Statistics', 'Plate Layout', 'PCR Protocol', 'QC']) expect(restored.getWorksheet(name), name).toBeDefined()
    expect(restored.getWorksheet('Summary')?.getCell('B2').value).toContain('SIMULATED DATA')
    expect(restored.getWorksheet('Raw Cq')?.getCell('J2').value).toBe(18.125)
    expect(restored.getWorksheet('ΔCq')?.getCell('G2').value).toBe(6.125)
    expect(restored.getWorksheet('Statistics')?.getCell('H2').value).toBe(0.0369)
    expect(restored.getWorksheet('Group Summary')?.getCell('G1').value).toBe('SD of sample-aggregated target Cq')
    expect(restored.getWorksheet('Raw Fluorescence')?.columnCount).toBeGreaterThan(30)
  })

  it('CSV export shares values with XLSX and safely escapes formula-like user text', () => {
    const project = createDefaultProject()
    project.groups[0].name = '=HYPERLINK("test","a,b")'
    project.genes[0].name = 'Ref,"quoted"\nsecond line'
    const result = fixture()
    const files = createCsvFiles(project, result)
    for (const filename of ['metadata.csv', 'groups.csv', 'genes.csv', 'wells.csv', 'cq.csv', 'fold-change.csv', 'statistics.csv', 'protocol.csv', 'qc.csv']) expect(files[filename]).toBeDefined()
    expect(files['groups.csv']).toContain('"\'=HYPERLINK(""test"",""a,b"")"')
    expect(files['genes.csv']).toContain('"Ref,""quoted""\nsecond line"')
    expect(files['statistics.csv']).toContain('0.0123,0.0369')
    expect(files['cq.csv']).toContain(',18.125,18.125,')
    expect(createWorkbook(project, result).getWorksheet('Raw Cq')?.getCell('E2').value).toBe(project.groups[0].name)
    expect(files['metadata.csv']).toContain('SIMULATED DATA')
  })

  it('clipboard summary labels technical previews and preserves the sample-level N', () => {
    const project = createDefaultProject()
    project.replicateMode = 'technical'
    const text = summaryTSV(project, fixture(), 'target1')
    expect(text).toContain('Technical preview — non-inferential')
    expect(text).toContain('Group\tR1\tR2\tR3\tMean\tSD\tGeometric mean\tN')
    expect(text).toContain('CTRL\t1\t\t\t1\t0\t1\t1')
  })

  it('keeps the original replicate columns when a sample is missing', () => {
    const project = createDefaultProject()
    const result = fixture()
    result.samples[0].replicate = 2
    result.samples[0].id = 'g1/2/target1'
    expect(summaryTSV(project, result, 'target1')).toContain('CTRL\t\t1\t\t1\t0\t1\t1')
  })

  it('retains raw curve headers when the first well has a missing Cq', () => {
    const result = fixture()
    const validWell = structuredClone(result.wells[0])
    result.wells[0].values = { ...result.wells[0].values, cq: Number.NaN }
    result.wells.push({ ...validWell, id: '1/A2', wellId: 'A2' })
    result.totalWells = 2
    const worksheet = createWorkbook(createDefaultProject(), result).getWorksheet('Raw Fluorescence')
    expect(worksheet?.getCell('E1').value).toBe('Cycle 1')
    expect(worksheet?.getCell('E2').value).toBeNull()
    expect(typeof worksheet?.getCell('E3').value).toBe('number')
  })

  it('raw workbook retains reference headers, exact plotted data and synthetic provenance', async () => {
    const project = createDefaultProject()
    const result = fixture()
    const workbook = createRawWorkbook(project, result, 0)
    const restored = new ExcelJS.Workbook()
    await restored.xlsx.load(await workbook.xlsx.writeBuffer())
    expect(restored.worksheets.map(sheet => sheet.name)).toEqual(['Summary', 'Sample Setup', 'Amplification Data', 'Melt Curve Raw Data', 'Melt Curve Result', 'Results'])
    const amplification = restored.getWorksheet('Amplification Data')!
    const melt = restored.getWorksheet('Melt Curve Raw Data')!
    expect(amplification.getRow(1).values).toEqual([undefined, ...RAW_COLUMNS.amplification])
    expect(melt.getRow(1).values).toEqual([undefined, ...RAW_COLUMNS.meltRaw])
    const ampPoints = rawAmplificationData(result.wells[0], project)
    const meltPoints = rawMeltingData(result.wells[0], project)
    expect(amplification.rowCount).toBe(ampPoints.length + 1)
    expect(melt.rowCount).toBe(meltPoints.length + 1)
    expect(amplification.getCell('E2').value).toBe(ampPoints[0].rn)
    expect(amplification.getCell('F2').value).toBe(ampPoints[0].deltaRn)
    expect(amplification.getCell('G2').value).toBe(ampPoints[0].baseline)
    expect(melt.getCell('E2').value).toBe(meltPoints[0].fluorescence)
    expect(melt.getCell('F2').value).toBe(meltPoints[0].derivative)
    expect(restored.getWorksheet('Melt Curve Result')?.getCell('L2').value).toBe(meltPoints[meltPoints.length - 1].fluorescence)
    const start = meltPoints[0]
    const next = meltPoints[1]
    expect(start.fluorescence - next.fluorescence).toBeCloseTo((start.derivative + next.derivative) * (next.temperature - start.temperature) / 2, 10)
    for (const sheet of restored.worksheets) {
      const headers = sheet.getRow(1).values
      expect(Array.isArray(headers)).toBe(true)
      const dataTypeColumn = (headers as ExcelJS.CellValue[]).indexOf('Data Type')
      expect(dataTypeColumn).toBeGreaterThan(0)
      expect(sheet.getRow(2).getCell(dataTypeColumn).value).toBe('SIMULATED')
    }
    expect(restored.getWorksheet('Raw Data')).toBeUndefined()
    expect(restored.getWorksheet('Summary')?.getColumn(2).values.join(' ')).toContain('NOT an instrument-calibrated')
  })

  it('one ZIP includes the analysis workbook and complete individual raw plates', async () => {
    const project = createDefaultProject()
    const result = fixture()
    result.wells.push({ ...structuredClone(result.wells[0]), id: '2/A1', key: 'g2/1/ref1/1', groupId: 'g2', sampleId: 'g2/1', plateIndex: 1 })
    result.totalWells = 2
    result.plateCount = 2
    const zip = await createXlsxBundle(project, result)
    const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }))
    expect(reopened.file(`${project.name}-SIMULATED.xlsx`)).not.toBeNull()
    expect(reopened.file('raw/SIMULATED-RAW-Plate-1.xlsx')).not.toBeNull()
    expect(reopened.file('raw/SIMULATED-RAW-Plate-2.xlsx')).not.toBeNull()
    expect(await reopened.file('README-SIMULATED.txt')!.async('string')).toContain('不是经过被动参比或探测器校准')
    const files = createCsvFiles(project, result)
    expect(files['raw/Plate-1/amplification.csv'].split('\r\n').length - 2).toBe(project.protocol.cycles)
    expect(files['raw/Plate-2/amplification.csv'].split('\r\n').length - 2).toBe(project.protocol.cycles)
    expect(files['raw/Plate-2/sample-setup.csv']).toContain('g2/1/ref1/1')
  })

  it('missing Cq stays blank on full raw grids and excluded wells remain flagged', () => {
    const project = createDefaultProject()
    const result = fixture()
    result.wells[0].values = { ...result.wells[0].values, cq: Number.NaN }
    result.wells[0].excluded = true
    const workbook = createRawWorkbook(project, result, 0)
    const amplitude = workbook.getWorksheet('Amplification Data')!
    expect(amplitude.rowCount).toBe(project.protocol.cycles + 1)
    expect(amplitude.getCell('E2').value).toBeNull()
    expect(amplitude.getCell('F2').value).toBeNull()
    expect(amplitude.getCell('L2').value).toBeNull()
    expect(amplitude.getCell('M2').value).toBe(true)
    expect(amplitude.getCell('N2').value).toBe('missing Cq')
    expect(workbook.getWorksheet('Results')?.getCell('E2').value).toBeNull()
    expect(workbook.getWorksheet('Results')?.getCell('H2').value).toBe(true)
    const csv = createCsvFiles(project, result)['raw/Plate-1/amplification.csv']
    expect(csv).toContain(',,,')
    expect(csv).toContain(',true,missing Cq,SIMULATED,')
  })

  it('raw CSV escapes sample labels and rejects oversized exports before truncation', () => {
    const project = createDefaultProject()
    const result = fixture()
    project.groups[0].name = '=1+1'
    project.genes[0].name = 'Target,"A"'
    const files = createCsvFiles(project, result)
    expect(files['raw/Plate-1/sample-setup.csv']).toContain("'=1+1 / B1")
    expect(files['raw/Plate-1/sample-setup.csv']).toContain('"Target,""A"""')
    const oversized = { ...result, wells: Array.from({ length: 9600 }, () => result.wells[0]) }
    expect(() => assertRawExportSize(project, oversized)).toThrow('未截断或下载任何数据')
    expect(() => createCsvFiles(project, oversized)).toThrow('2,000,000')
  })

  it('rejects invalid baseline windows before exporting undefined Delta Rn', () => {
    const project = createDefaultProject()
    project.protocol.cqDetection.baselineStartCycle = 15
    project.protocol.cqDetection.baselineEndCycle = 10
    expect(() => createCsvFiles(project, fixture())).toThrow('Cq 基线区间')
    project.protocol.cqDetection.baselineStartCycle = 1.5
    expect(() => createRawWorkbook(project, fixture(), 0)).toThrow('Cq 基线区间')
    project.protocol.cqDetection.baselineStartCycle = 3
    project.protocol.cqDetection.baselineEndCycle = project.protocol.cycles
    expect(() => createRawWorkbook(project, fixture(), 0)).toThrow('Cq 基线区间')
  })
})
