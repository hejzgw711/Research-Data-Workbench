import { createRng, gaussian } from './rng'
import type {
  ConcentrationUnit,
  CycleKind,
  CyclePlan,
  CycleResult,
  DataPoint,
  Phase,
  SimulationResult,
  SimulationSettings,
} from './types'

export const defaultSettings: SimulationSettings = {
  experimentName: 'SPR Synthetic Run',
  sampleName: 'Synthetic-1',
  ligandName: 'Ligand-1',
  molecularWeightDa: 40000,
  outputPrefix: 'spr-synthetic',
  concentrationsText: '0, 3.125, 6.25, 12.5, 25, 50, 100',
  concentrationUnit: 'uM',
  replicates: 2,
  startupCycles: 3,
  solventCycles: 2,
  ka: 2500,
  kd: 0.015,
  rmaxRU: 800,
  baselineS: 72,
  associationS: 60,
  dissociationS: 300,
  samplingIntervalS: 1,
  fc1BaselineRU: 1200,
  fc2BaselineRU: 8500,
  noiseSDRU: 0.8,
  driftRUPerS: 0.0015,
  bulkRIRU: 38,
  spikeRU: 24,
  concentrationCvPct: 2,
  rmaxCvPct: 2,
  regenerationResidualPct: 0,
  seed: 20260829,
}

const unitFactor: Record<ConcentrationUnit, number> = {
  pM: 1e-12,
  nM: 1e-9,
  uM: 1e-6,
  mM: 1e-3,
}

const finiteNonNegative = (value: number, fallback: number) =>
  Number.isFinite(value) && value >= 0 ? value : fallback

export function normalizeSettings(input: SimulationSettings): SimulationSettings {
  return {
    ...input,
    molecularWeightDa: finiteNonNegative(input.molecularWeightDa, 40000),
    replicates: Math.max(1, Math.min(6, Math.round(input.replicates || 1))),
    startupCycles: Math.max(0, Math.min(8, Math.round(input.startupCycles || 0))),
    solventCycles: Math.max(0, Math.min(8, Math.round(input.solventCycles || 0))),
    ka: Math.max(finiteNonNegative(input.ka, 2500), 1e-12),
    kd: Math.max(finiteNonNegative(input.kd, 0.015), 1e-12),
    rmaxRU: finiteNonNegative(input.rmaxRU, 800),
    baselineS: Math.max(finiteNonNegative(input.baselineS, 72), 1),
    associationS: Math.max(finiteNonNegative(input.associationS, 60), 1),
    dissociationS: Math.max(finiteNonNegative(input.dissociationS, 300), 1),
    samplingIntervalS: Math.max(finiteNonNegative(input.samplingIntervalS, 1), 0.1),
    fc1BaselineRU: finiteNonNegative(input.fc1BaselineRU, 1200),
    fc2BaselineRU: finiteNonNegative(input.fc2BaselineRU, 8500),
    noiseSDRU: finiteNonNegative(input.noiseSDRU, 0.8),
    driftRUPerS: finiteNonNegative(input.driftRUPerS, 0.0015),
    bulkRIRU: finiteNonNegative(input.bulkRIRU, 38),
    spikeRU: finiteNonNegative(input.spikeRU, 24),
    concentrationCvPct: Math.min(finiteNonNegative(input.concentrationCvPct, 2), 50),
    rmaxCvPct: Math.min(finiteNonNegative(input.rmaxCvPct, 2), 50),
    regenerationResidualPct: Math.min(
      finiteNonNegative(input.regenerationResidualPct, 0),
      100,
    ),
    seed: Math.round(Number.isFinite(input.seed) ? input.seed : 20260829),
  }
}

export function parseConcentrations(text: string, unit: ConcentrationUnit): number[] {
  const values = text
    .split(/[\s,，;；]+/)
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0)
  return [...new Set(values)].map((value) => value * unitFactor[unit])
}

export function concentrationToDisplay(valueM: number): string {
  if (valueM === 0) return '0 μM'
  if (valueM < 1e-9) return `${Number((valueM * 1e12).toPrecision(4))} pM`
  if (valueM < 1e-6) return `${Number((valueM * 1e9).toPrecision(4))} nM`
  if (valueM < 1e-3) return `${Number((valueM * 1e6).toPrecision(4))} μM`
  return `${Number((valueM * 1e3).toPrecision(4))} mM`
}

export function oneToOneResponse(
  concentrationM: number,
  ka: number,
  kd: number,
  rmaxRU: number,
  associationTimeS: number,
  initialResponseRU = 0,
): number {
  const kobs = ka * concentrationM + kd
  const equilibrium = rmaxRU * ((ka * concentrationM) / kobs)
  return equilibrium + (initialResponseRU - equilibrium) * Math.exp(-kobs * associationTimeS)
}

function phaseAt(timeCycleS: number, settings: SimulationSettings): Phase {
  if (timeCycleS < settings.baselineS) return 'baseline'
  if (timeCycleS < settings.baselineS + settings.associationS) return 'association'
  return 'dissociation'
}

function phaseTime(timeCycleS: number, phase: Phase, settings: SimulationSettings): number {
  if (phase === 'baseline') return timeCycleS
  if (phase === 'association') return timeCycleS - settings.baselineS
  return timeCycleS - settings.baselineS - settings.associationS
}

function deliveryFraction(phase: Phase, phaseTimeS: number): number {
  if (phase === 'baseline') return 0
  if (phase === 'association') return 1 - Math.exp(-phaseTimeS / 0.8)
  return Math.exp(-phaseTimeS / 1.1)
}

function spikeAt(
  phase: Phase,
  phaseTimeS: number,
  associationS: number,
  amplitudeRU: number,
): number {
  if (phase === 'association') return amplitudeRU * Math.exp(-phaseTimeS / 0.65)
  if (phase === 'dissociation') return -0.65 * amplitudeRU * Math.exp(-phaseTimeS / 0.7)
  if (phaseTimeS > associationS) return 0
  return 0
}

function makeCyclePlan(
  id: number,
  kind: CycleKind,
  replicate: number,
  nominalConcentrationM: number,
  settings: SimulationSettings,
): CyclePlan {
  const rng = createRng(`${settings.seed}:cycle:${id}`)
  const concentrationScale = Math.max(
    0,
    1 + gaussian(rng) * (settings.concentrationCvPct / 100),
  )
  const rmaxScale = Math.max(0, 1 + gaussian(rng) * (settings.rmaxCvPct / 100))
  const typeLabel = kind === 'startup' ? 'Startup' : kind === 'solvent' ? 'Solvent' : concentrationToDisplay(nominalConcentrationM)
  return {
    id,
    kind,
    replicate,
    nominalConcentrationM,
    actualConcentrationM: nominalConcentrationM * concentrationScale,
    actualRmaxRU: settings.rmaxRU * rmaxScale,
    label: kind === 'sample' ? `${typeLabel} · R${replicate}` : `${typeLabel} ${replicate}`,
  }
}

function buildPlans(settings: SimulationSettings, concentrationsM: number[]): CyclePlan[] {
  const plans: CyclePlan[] = []
  let id = 1
  for (let index = 1; index <= settings.startupCycles; index += 1) {
    plans.push(makeCyclePlan(id, 'startup', index, 0, settings))
    id += 1
  }
  for (const concentrationM of concentrationsM) {
    for (let replicate = 1; replicate <= settings.replicates; replicate += 1) {
      plans.push(makeCyclePlan(id, 'sample', replicate, concentrationM, settings))
      id += 1
    }
  }
  for (let index = 1; index <= settings.solventCycles; index += 1) {
    plans.push(makeCyclePlan(id, 'solvent', index, 0, settings))
    id += 1
  }
  return plans
}

function simulateCycle(
  plan: CyclePlan,
  settings: SimulationSettings,
  globalStartS: number,
  carriedResponseRU: number,
): { result: CycleResult; finalResponseRU: number } {
  const rng = createRng(`${settings.seed}:points:${plan.id}`)
  const totalDurationS = settings.baselineS + settings.associationS + settings.dissociationS
  const pointCount = Math.max(1, Math.ceil(totalDurationS / settings.samplingIntervalS))
  const baselineStartResponse = plan.kind === 'sample' ? carriedResponseRU : 0
  const associationStartResponse =
    baselineStartResponse * Math.exp(-settings.kd * settings.baselineS)
  const associationEndResponse = oneToOneResponse(
    plan.actualConcentrationM,
    settings.ka,
    settings.kd,
    plan.actualRmaxRU,
    settings.associationS,
    associationStartResponse,
  )

  const points: DataPoint[] = []
  for (let index = 0; index < pointCount; index += 1) {
    const timeCycleS = index * settings.samplingIntervalS
    const phase = phaseAt(timeCycleS, settings)
    const timePhaseS = phaseTime(timeCycleS, phase, settings)
    const timeAlignedS = timeCycleS - settings.baselineS
    const delivery = deliveryFraction(phase, timePhaseS)
    const deliveredConcentrationM = plan.actualConcentrationM * delivery

    let modelTruthRU = 0
    if (plan.kind === 'sample') {
      if (phase === 'baseline') {
        modelTruthRU = baselineStartResponse * Math.exp(-settings.kd * timePhaseS)
      } else if (phase === 'association') {
        modelTruthRU = oneToOneResponse(
          plan.actualConcentrationM,
          settings.ka,
          settings.kd,
          plan.actualRmaxRU,
          timePhaseS,
          associationStartResponse,
        )
      } else {
        modelTruthRU = associationEndResponse * Math.exp(-settings.kd * timePhaseS)
      }
    }

    const controlAmplitude = plan.kind === 'startup' ? 92 : plan.kind === 'solvent' ? 145 : 0
    const controlResponse = controlAmplitude * delivery
    const bulkFc1RU = settings.bulkRIRU * 0.78 * delivery
    const bulkFc2RU = settings.bulkRIRU * delivery
    const commonDriftRU = settings.driftRUPerS * (globalStartS + timeCycleS)
    const spike = spikeAt(phase, timePhaseS, settings.associationS, settings.spikeRU)
    const fc1SpikeRU = spike * 0.65
    const fc2SpikeRU = spike
    const fc1NoiseRU = gaussian(rng) * settings.noiseSDRU
    const fc2NoiseRU = gaussian(rng) * settings.noiseSDRU
    const fc1RU =
      settings.fc1BaselineRU +
      commonDriftRU +
      bulkFc1RU +
      controlResponse * 0.55 +
      fc1SpikeRU +
      fc1NoiseRU
    const fc2RU =
      settings.fc2BaselineRU +
      modelTruthRU +
      commonDriftRU * 1.04 +
      bulkFc2RU +
      controlResponse +
      fc2SpikeRU +
      fc2NoiseRU
    const fc2MinusFc1RU = fc2RU - fc1RU

    points.push({
      cycleId: plan.id,
      cycleKind: plan.kind,
      replicate: plan.replicate,
      phase,
      timeGlobalS: globalStartS + timeCycleS,
      timeCycleS,
      timePhaseS,
      timeAlignedS,
      nominalConcentrationM: plan.nominalConcentrationM,
      actualConcentrationM: plan.actualConcentrationM,
      deliveredConcentrationM,
      actualRmaxRU: plan.actualRmaxRU,
      modelTruthRU,
      fc1RU,
      fc2RU,
      fc2MinusFc1RU,
      baselineCorrectedRU: 0,
      doubleReferencedRU: 0,
      bulkFc1RU,
      bulkFc2RU,
      commonDriftRU,
      fc1NoiseRU,
      fc2NoiseRU,
      fc1SpikeRU,
      fc2SpikeRU,
    })
  }

  const baselinePoints = points.filter((point) => point.phase === 'baseline')
  const baselineMean =
    baselinePoints.reduce((sum, point) => sum + point.fc2MinusFc1RU, 0) /
    Math.max(baselinePoints.length, 1)
  for (const point of points) {
    point.baselineCorrectedRU = point.fc2MinusFc1RU - baselineMean
    point.doubleReferencedRU = point.baselineCorrectedRU
  }

  const finalResponseRU =
    plan.kind === 'sample'
      ? associationEndResponse * Math.exp(-settings.kd * settings.dissociationS)
      : 0
  return { result: { plan, points }, finalResponseRU }
}

function applyBlankReference(cycles: CycleResult[], samplingIntervalS: number): void {
  const blanks = cycles.filter(
    (cycle) => cycle.plan.kind === 'sample' && cycle.plan.nominalConcentrationM === 0,
  )
  if (blanks.length === 0) return

  const blankByIndex = new Map<number, number>()
  const pointCount = Math.max(...blanks.map((cycle) => cycle.points.length))
  for (let index = 0; index < pointCount; index += 1) {
    const values = blanks
      .map((cycle) => cycle.points[index]?.baselineCorrectedRU)
      .filter((value): value is number => Number.isFinite(value))
    if (values.length > 0) {
      blankByIndex.set(index, values.reduce((sum, value) => sum + value, 0) / values.length)
    }
  }

  for (const cycle of cycles) {
    if (cycle.plan.kind !== 'sample') continue
    cycle.points.forEach((point, index) => {
      point.doubleReferencedRU = point.baselineCorrectedRU - (blankByIndex.get(index) ?? 0)
      point.timeAlignedS = Number(point.timeAlignedS.toFixed(samplingIntervalS < 1 ? 3 : 6))
    })
  }
}

export function simulateExperiment(input: SimulationSettings): SimulationResult {
  const settings = normalizeSettings(input)
  const concentrationsM = parseConcentrations(
    settings.concentrationsText,
    settings.concentrationUnit,
  )
  if (concentrationsM.length === 0) {
    throw new Error('请至少输入一个大于或等于 0 的有效浓度。')
  }

  const plans = buildPlans(settings, concentrationsM)
  const cycles: CycleResult[] = []
  const cycleDurationS = settings.baselineS + settings.associationS + settings.dissociationS
  let globalStartS = 0
  let carriedResponseRU = 0
  for (const plan of plans) {
    const simulated = simulateCycle(plan, settings, globalStartS, carriedResponseRU)
    cycles.push(simulated.result)
    carriedResponseRU =
      simulated.finalResponseRU * (settings.regenerationResidualPct / 100)
    globalStartS += cycleDurationS
  }
  applyBlankReference(cycles, settings.samplingIntervalS)

  return {
    settings,
    concentrationsM,
    kdM: settings.kd / settings.ka,
    halfLifeS: Math.log(2) / settings.kd,
    cycles,
    points: cycles.flatMap((cycle) => cycle.points),
    sampleCycleCount: cycles.filter((cycle) => cycle.plan.kind === 'sample').length,
    createdAt: new Date().toISOString(),
  }
}
