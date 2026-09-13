import JSZip from 'jszip'
import { concentrationToDisplay } from './simulator'
import type { CurveKey, DataPoint, SimulationResult } from './types'

export type ReplicateView = 'separate' | 'mean-sd'

export interface TableData {
  headers: string[]
  rows: Array<Array<string | number>>
}

const curveLabels: Record<CurveKey, string> = {
  modelTruthRU: 'Model truth',
  fc1RU: 'Fc1',
  fc2RU: 'Fc2',
  fc2MinusFc1RU: 'Fc2-Fc1',
  baselineCorrectedRU: 'Baseline corrected',
  doubleReferencedRU: 'Double referenced',
}

const numberCell = (value: number) => Number(value.toFixed(6))

export function exportPrefix(value: string): string {
  return !value || value === 'spr-synthetic' ? 'spr-data' : value
}

function exportExperimentName(value: string): string {
  return value === 'SPR Synthetic Run' ? 'SPR Run' : value
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1),
  )
}

export function buildPlotTable(
  result: SimulationResult,
  curve: CurveKey,
  replicateView: ReplicateView,
): TableData {
  const sampleCycles = result.cycles.filter((cycle) => cycle.plan.kind === 'sample')
  const rowCount = Math.max(...sampleCycles.map((cycle) => cycle.points.length))

  if (replicateView === 'separate') {
    const headers = [
      'Time_s',
      ...sampleCycles.map(
        (cycle) =>
          `${concentrationToDisplay(cycle.plan.nominalConcentrationM)}_R${cycle.plan.replicate}`,
      ),
    ]
    const rows = Array.from({ length: rowCount }, (_, index) => [
      numberCell(sampleCycles[0].points[index]?.timeAlignedS ?? 0),
      ...sampleCycles.map((cycle) => numberCell(cycle.points[index]?.[curve] ?? Number.NaN)),
    ])
    return { headers, rows }
  }

  const groups = result.concentrationsM.map((concentrationM) => ({
    concentrationM,
    cycles: sampleCycles.filter(
      (cycle) => cycle.plan.nominalConcentrationM === concentrationM,
    ),
  }))
  const headers = [
    'Time_s',
    ...groups.flatMap((group) => {
      const label = concentrationToDisplay(group.concentrationM)
      return [`${label}_mean`, `${label}_SD`]
    }),
  ]
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const values = groups.flatMap((group) => {
      const observations = group.cycles
        .map((cycle) => cycle.points[index]?.[curve])
        .filter((value): value is number => Number.isFinite(value))
      const mean = observations.reduce((sum, value) => sum + value, 0) / observations.length
      return [numberCell(mean), numberCell(standardDeviation(observations))]
    })
    return [numberCell(sampleCycles[0].points[index]?.timeAlignedS ?? 0), ...values]
  })
  return { headers, rows }
}

export function buildLongPlotTable(result: SimulationResult, curve: CurveKey): TableData {
  const headers = [
    'time_s',
    'cycle',
    'concentration_M',
    'concentration_display',
    'replicate',
    'curve_type',
    'response_RU',
  ]
  const rows = result.cycles
    .filter((cycle) => cycle.plan.kind === 'sample')
    .flatMap((cycle) =>
      cycle.points.map((point) => [
        numberCell(point.timeAlignedS),
        cycle.plan.id,
        cycle.plan.nominalConcentrationM,
        concentrationToDisplay(cycle.plan.nominalConcentrationM),
        cycle.plan.replicate,
        curveLabels[curve],
        numberCell(point[curve]),
      ]),
    )
  return { headers, rows }
}

const rawHeaders = [
  'run_id',
  'experiment_name',
  'cycle_id',
  'cycle_type',
  'replicate',
  'phase',
  'time_global_s',
  'time_cycle_s',
  'time_phase_s',
  'time_injection_aligned_s',
  'nominal_concentration_M',
  'actual_concentration_M',
  'delivered_concentration_M',
  'actual_rmax_RU',
  'model_truth_RU',
  'fc1_RU',
  'fc2_RU',
  'fc2_minus_fc1_RU',
  'baseline_corrected_RU',
  'double_referenced_RU',
  'bulk_fc1_RU',
  'bulk_fc2_RU',
  'common_drift_RU',
  'fc1_noise_RU',
  'fc2_noise_RU',
  'fc1_spike_RU',
  'fc2_spike_RU',
]

function rawRow(result: SimulationResult, point: DataPoint): Array<string | number> {
  return [
    exportPrefix(result.settings.outputPrefix),
    exportExperimentName(result.settings.experimentName),
    point.cycleId,
    point.cycleKind,
    point.replicate,
    point.phase,
    numberCell(point.timeGlobalS),
    numberCell(point.timeCycleS),
    numberCell(point.timePhaseS),
    numberCell(point.timeAlignedS),
    point.nominalConcentrationM,
    point.actualConcentrationM,
    point.deliveredConcentrationM,
    numberCell(point.actualRmaxRU),
    numberCell(point.modelTruthRU),
    numberCell(point.fc1RU),
    numberCell(point.fc2RU),
    numberCell(point.fc2MinusFc1RU),
    numberCell(point.baselineCorrectedRU),
    numberCell(point.doubleReferencedRU),
    numberCell(point.bulkFc1RU),
    numberCell(point.bulkFc2RU),
    numberCell(point.commonDriftRU),
    numberCell(point.fc1NoiseRU),
    numberCell(point.fc2NoiseRU),
    numberCell(point.fc1SpikeRU),
    numberCell(point.fc2SpikeRU),
  ]
}

export function buildRawTable(result: SimulationResult): TableData {
  return { headers: rawHeaders, rows: result.points.map((point) => rawRow(result, point)) }
}

function escapeCsv(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function tableToCsv(table: TableData): string {
  return [table.headers, ...table.rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\r\n')
}

export function tableToTsv(table: TableData): string {
  return [table.headers, ...table.rows]
    .map((row) => row.map((value) => String(value)).join('\t'))
    .join('\r\n')
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadText(text: string, filename: string, type = 'text/csv;charset=utf-8') {
  downloadBlob(new Blob(['\uFEFF', text], { type }), filename)
}

export function experimentMetadata(result: SimulationResult) {
  return {
    generator: '生成可分析科研数据工作台',
    version: '0.1.0',
    createdAt: result.createdAt,
    seed: result.settings.seed,
    kinetics: {
      model: '1:1 Langmuir',
      ka_M_inv_s_inv: result.settings.ka,
      kd_s_inv: result.settings.kd,
      KD_M: result.kdM,
      Rmax_RU: result.settings.rmaxRU,
    },
    settings: {
      ...result.settings,
      outputPrefix: exportPrefix(result.settings.outputPrefix),
      experimentName: exportExperimentName(result.settings.experimentName),
      sampleName: result.settings.sampleName === 'Synthetic-1' ? 'Sample-1' : result.settings.sampleName,
    },
    concentrations_M: result.concentrationsM,
    cycles: result.cycles.map((cycle) => cycle.plan),
  }
}

export async function downloadDatasetZip(
  result: SimulationResult,
  curve: CurveKey,
  replicateView: ReplicateView,
): Promise<void> {
  const zip = new JSZip()
  const prefix = exportPrefix(result.settings.outputPrefix)
  const plotWide = buildPlotTable(result, curve, replicateView)
  const plotLong = buildLongPlotTable(result, curve)
  const raw = buildRawTable(result)
  const processed: TableData = {
    headers: [
      'cycle_id',
      'time_injection_aligned_s',
      'concentration_M',
      'fc2_minus_fc1_RU',
      'baseline_corrected_RU',
      'double_referenced_RU',
    ],
    rows: result.points.map((point) => [
      point.cycleId,
      numberCell(point.timeAlignedS),
      point.nominalConcentrationM,
      numberCell(point.fc2MinusFc1RU),
      numberCell(point.baselineCorrectedRU),
      numberCell(point.doubleReferencedRU),
    ]),
  }
  const cycles: TableData = {
    headers: [
      'cycle_id',
      'cycle_type',
      'replicate',
      'nominal_concentration_M',
      'actual_concentration_M',
      'actual_rmax_RU',
    ],
    rows: result.cycles.map(({ plan }) => [
      plan.id,
      plan.kind,
      plan.replicate,
      plan.nominalConcentrationM,
      plan.actualConcentrationM,
      numberCell(plan.actualRmaxRU),
    ]),
  }

  zip.file(
    'README.txt',
    [
      '生成可分析科研数据工作台',
      'SPR dataset: 1:1 Langmuir response with reference-channel processing.',
      `Seed: ${result.settings.seed}`,
      'Units: time = seconds; response = RU; concentration = M unless otherwise specified.',
      'Association injection starts at time_injection_aligned_s = 0.',
    ].join('\r\n'),
  )
  zip.file('experiment.json', JSON.stringify(experimentMetadata(result), null, 2))
  zip.file('run_plan.csv', tableToCsv(cycles))
  zip.file('raw/all_points.csv', tableToCsv(raw))
  zip.file('processed/processed_points.csv', tableToCsv(processed))
  zip.file('plot/overlay_wide.csv', tableToCsv(plotWide))
  zip.file('plot/overlay_long.csv', tableToCsv(plotLong))
  zip.file(
    'ground_truth/kinetic_parameters.json',
    JSON.stringify(experimentMetadata(result).kinetics, null, 2),
  )
  zip.file('metadata/cycles.csv', tableToCsv(cycles))
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, `${prefix}-dataset.zip`)
}
