export type Theme = 'light' | 'dark'
export type QCLevel = 'pass' | 'warning' | 'fail'
export interface QCResult { id: string; level: QCLevel; message: string; wellIds?: string[]; sampleIds?: string[] }
export interface FoldConfig { mean: number; sd: number; sdMode: 'auto' | 'manual' }
export interface ExperimentGroup {
  id: string; name: string; isCalibrator: boolean; biologicalReplicates: number;
  technicalReplicates: number; technicalCqSD: number; targetFoldByGene: Record<string, FoldConfig>
}
export interface GeneConfig {
  id: string; name: string; type: 'reference' | 'target'; nominalCq: number;
  tmC: number; primerConcentration: number; meltFwhmC: number
}
export interface StatisticalComparison { id: string; leftGroupId: string; rightGroupId: string }
export interface PCRStep { temperatureC: number; holdSeconds: number; rampRateCPerSec: number; acquisition: 'none' | 'single' | 'continuous' }
export interface PCRProtocol {
  mode: 'two-step' | 'three-step'; cycles: number;
  preincubation: PCRStep; denaturation: PCRStep; annealing: PCRStep; extension: PCRStep;
  meltHigh: PCRStep; meltLow: PCRStep; meltEnd: PCRStep; cooling: PCRStep;
  coolingEnabled: boolean; readingsPerC: number; channel: string; volume: number;
  quantFactor: number; meltFactor: number; acquisitionMode: 'dynamic' | 'fixed';
  cqDetection: { mode: 'baseline-delta-f' | 'fixed-threshold'; threshold: number; baselineStartCycle: number; baselineEndCycle: number }
}
export interface SimulationConfig {
  /** Missing in algorithm-1 projects; absence replays the original curves. */
  curveModel?: 'legacy-v1' | 'reference-v1';
  preset: 'realistic' | 'precision'; noiseLevel: 'low' | 'medium' | 'high';
  referenceCqSD: number; fluorescenceNoise: number; tmSD: number;
  cqWarningSD: number; cqFailSD: number; tmWarning: number; tmFail: number;
  correction: 'none' | 'holm'
}
export interface WellValues { cq: number; tm: number; plateau: number; slope: number; noise: number; baseline: number; fwhm: number }
export type WellOverride = Partial<WellValues> & { excluded?: boolean }
export interface QPCRProject {
  id: string; name: string; theme: Theme; randomSeed: number;
  replicateMode: 'biological' | 'technical'; inputMode: 'distribution' | 'manual';
  groups: ExperimentGroup[]; genes: GeneConfig[]; comparisons: StatisticalComparison[];
  protocol: PCRProtocol; simulation: SimulationConfig;
  manualOverrides: Record<string, WellOverride>; manualCq: Record<string, number>;
  rowSeeds: Record<string, number>
}
export interface Well {
  id: string; key: string; wellId: string; plateIndex: number; row: string; column: number;
  groupId: string; geneId: string; sampleId: string; biologicalReplicate: number; technicalReplicate: number;
  generated: WellValues; values: WellValues; excluded: boolean; adjusted: boolean; qc: QCResult[]
}
export interface SampleAnalysis {
  id: string; groupId: string; geneId: string; replicate: number;
  referenceCq: number; targetCq: number; deltaCq: number; deltaDeltaCq: number; fold: number;
  technicalN: number; inferential: boolean
}
export interface GroupAnalysis {
  groupId: string; geneId: string; n: number; mean: number; sd: number; geometricMean: number;
  folds: number[]; deltaCqs: number[]; cqSD: number
}
export interface ComparisonResult {
  id: string; geneId: string; leftGroupId: string; rightGroupId: string;
  rawP: number | null; p: number | null; statistic: number | null; df: number | null;
  label: string; inferential: boolean; status: 'ok' | 'not_applicable'; reason?: string
}
export interface SimulationResult {
  wells: Well[]; samples: SampleAnalysis[]; groups: GroupAnalysis[];
  comparisons: ComparisonResult[]; qc: QCResult[]; totalWells: number; plateCount: number
}
export interface CurvePoint { x: number; y: number }
export type ProjectUpdater = (recipe: (project: QPCRProject) => void) => void
