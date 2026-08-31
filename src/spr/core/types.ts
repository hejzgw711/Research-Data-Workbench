export type ConcentrationUnit = 'pM' | 'nM' | 'uM' | 'mM'
export type CycleKind = 'startup' | 'sample' | 'solvent'
export type Phase = 'baseline' | 'association' | 'dissociation'
export type CurveKey =
  | 'modelTruthRU'
  | 'fc1RU'
  | 'fc2RU'
  | 'fc2MinusFc1RU'
  | 'baselineCorrectedRU'
  | 'doubleReferencedRU'

export interface SimulationSettings {
  experimentName: string
  sampleName: string
  ligandName: string
  molecularWeightDa: number
  outputPrefix: string
  concentrationsText: string
  concentrationUnit: ConcentrationUnit
  replicates: number
  startupCycles: number
  solventCycles: number
  ka: number
  kd: number
  rmaxRU: number
  baselineS: number
  associationS: number
  dissociationS: number
  samplingIntervalS: number
  fc1BaselineRU: number
  fc2BaselineRU: number
  noiseSDRU: number
  driftRUPerS: number
  bulkRIRU: number
  spikeRU: number
  concentrationCvPct: number
  rmaxCvPct: number
  regenerationResidualPct: number
  seed: number
}

export interface CyclePlan {
  id: number
  kind: CycleKind
  replicate: number
  nominalConcentrationM: number
  actualConcentrationM: number
  actualRmaxRU: number
  label: string
}

export interface DataPoint {
  cycleId: number
  cycleKind: CycleKind
  replicate: number
  phase: Phase
  timeGlobalS: number
  timeCycleS: number
  timePhaseS: number
  timeAlignedS: number
  nominalConcentrationM: number
  actualConcentrationM: number
  deliveredConcentrationM: number
  actualRmaxRU: number
  modelTruthRU: number
  fc1RU: number
  fc2RU: number
  fc2MinusFc1RU: number
  baselineCorrectedRU: number
  doubleReferencedRU: number
  bulkFc1RU: number
  bulkFc2RU: number
  commonDriftRU: number
  fc1NoiseRU: number
  fc2NoiseRU: number
  fc1SpikeRU: number
  fc2SpikeRU: number
}

export interface CycleResult {
  plan: CyclePlan
  points: DataPoint[]
}

export interface SimulationResult {
  settings: SimulationSettings
  concentrationsM: number[]
  kdM: number
  halfLifeS: number
  cycles: CycleResult[]
  points: DataPoint[]
  sampleCycleCount: number
  createdAt: string
}
