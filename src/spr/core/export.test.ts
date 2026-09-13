import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildLongPlotTable,
  buildPlotTable,
  buildRawTable,
  downloadDatasetZip,
  experimentMetadata,
  exportPrefix,
  tableToCsv,
  tableToTsv,
} from './export'
import { defaultSettings, simulateExperiment } from './simulator'

const result = simulateExperiment(defaultSettings)
const displayMarker = /synthetic|simulated|模拟数据|合成数据/i

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SPR teaching exports', () => {
  it('uses a neutral default filename prefix without changing custom prefixes', () => {
    expect(exportPrefix('')).toBe('spr-data')
    expect(exportPrefix('spr-synthetic')).toBe('spr-data')
    expect(exportPrefix('my-synthetic-run')).toBe('my-synthetic-run')
  })

  it('exports neutral default identifiers without changing data values or source settings', () => {
    const raw = buildRawTable(result)
    expect(raw.rows[0].slice(0, 2)).toEqual(['spr-data', 'SPR Run'])
    expect(raw.rows).toHaveLength(result.points.length)
    expect(raw.rows[0][2]).toBe(result.points[0].cycleId)
    expect(raw.rows[0][16]).toBe(Number(result.points[0].fc2RU.toFixed(6)))
    expect(result.settings.outputPrefix).toBe('spr-synthetic')
    expect(result.settings.experimentName).toBe('SPR Synthetic Run')
  })

  it('leaves user-provided identifiers and all numeric cells unchanged', () => {
    const custom = {
      ...result,
      settings: { ...result.settings, outputPrefix: 'study-42', experimentName: 'My synthetic control' },
    }
    const originalRows = buildRawTable(result).rows
    const customRows = buildRawTable(custom).rows
    expect(customRows[0].slice(0, 2)).toEqual(['study-42', 'My synthetic control'])
    expect(customRows.map((row) => row.slice(2))).toEqual(originalRows.map((row) => row.slice(2)))
  })

  it('keeps parameters and seed in JSON without automatic display markers', () => {
    const metadata = experimentMetadata(result)
    expect(JSON.stringify(metadata)).not.toMatch(displayMarker)
    expect(metadata).not.toHaveProperty('synthetic')
    expect(metadata.seed).toBe(result.settings.seed)
    expect(metadata.settings.sampleName).toBe('Sample-1')
    expect(metadata.kinetics.ka_M_inv_s_inv).toBe(result.settings.ka)
    expect(metadata.cycles).toEqual(result.cycles.map((cycle) => cycle.plan))
    expect(result.settings.sampleName).toBe('Synthetic-1')
  })

  it('keeps custom metadata names verbatim', () => {
    const custom = { ...result, settings: { ...result.settings, sampleName: 'Synthetic-control-2' } }
    expect(experimentMetadata(custom).settings.sampleName).toBe('Synthetic-control-2')
  })

  it('exports default plot, raw and clipboard tables without automatic markers', () => {
    const tables = [
      buildPlotTable(result, 'doubleReferencedRU', 'separate'),
      buildPlotTable(result, 'doubleReferencedRU', 'mean-sd'),
      buildLongPlotTable(result, 'doubleReferencedRU'),
      buildRawTable(result),
    ]
    tables.forEach((table) => {
      expect(tableToCsv(table)).not.toMatch(displayMarker)
      expect(tableToTsv(table)).not.toMatch(displayMarker)
    })
  })

  it('downloads a neutral ZIP whose files retain method details but no automatic markers', async () => {
    let downloadedBlob: Blob | undefined
    const anchor = { href: '', download: '', click: vi.fn() }
    vi.stubGlobal('document', { createElement: () => anchor })
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      downloadedBlob = blob as Blob
      return 'blob:spr-export-test'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    await downloadDatasetZip(result, 'doubleReferencedRU', 'separate')
    expect(anchor.download).toBe('spr-data-dataset.zip')
    expect(anchor.click).toHaveBeenCalledOnce()
    const zip = await JSZip.loadAsync(await downloadedBlob!.arrayBuffer())
    for (const [name, entry] of Object.entries(zip.files)) {
      expect(name).not.toMatch(displayMarker)
      if (!entry.dir) expect(await entry.async('string')).not.toMatch(displayMarker)
    }
    expect(await zip.file('README.txt')!.async('string')).toContain('1:1 Langmuir')
    const metadata = JSON.parse(await zip.file('experiment.json')!.async('string'))
    expect(metadata.seed).toBe(result.settings.seed)
    expect(metadata.kinetics.Rmax_RU).toBe(result.settings.rmaxRU)
    expect(await zip.file('raw/all_points.csv')!.async('string')).toBe(tableToCsv(buildRawTable(result)))
  })
})
