export type ImageKind = 'target' | 'loading'
export type Polarity = 'dark' | 'bright'

export interface ImageDocument { fileName: string; width: number; height: number; bitDepth: 8 | 16; channel: string; source: 'demo' | 'upload'; pixels: Uint8Array | Uint16Array }
export interface Rect { x: number; y: number; width: number; height: number }
export interface LaneAssignment { id: string; index: number; targetRect: Rect; loadingRect: Rect; sample: string; group: string; replicate: string }
export interface PixelStats { area: number; meanGray: number; minGray: number; maxGray: number; rawIntDen: number; saturated: number }
export interface PairMeasurement { lane: LaneAssignment; target: PixelStats | null; loading: PixelStats | null; targetCorrected: number | null; loadingCorrected: number | null; normalized: number | null; relativeExpression: number | null; qc: string[] }
export interface GroupSummary { group: string; values: number[]; n: number; mean: number | null; sd: number | null; sem: number | null }

export function measureRect(image: ImageDocument | null, rect: Rect | null): PixelStats | null {
  if (!image || !rect) return null
  const x0 = Math.max(0, Math.min(image.width, Math.floor(rect.x))); const y0 = Math.max(0, Math.min(image.height, Math.floor(rect.y)))
  const x1 = Math.max(x0, Math.min(image.width, Math.ceil(rect.x + rect.width))); const y1 = Math.max(y0, Math.min(image.height, Math.ceil(rect.y + rect.height)))
  const saturationMax = image.bitDepth === 16 ? 65535 : 255
  let count = 0; let sum = 0; let min = saturationMax; let max = 0; let saturated = 0
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { const value = image.pixels[y * image.width + x]; count += 1; sum += value; min = Math.min(min, value); max = Math.max(max, value); if (value === 0 || value === saturationMax) saturated += 1 }
  const meanGray = count ? sum / count : 0
  return { area: count, meanGray, minGray: count ? min : 0, maxGray: count ? max : 0, rawIntDen: count * meanGray, saturated }
}

function smoothedProfile(image: ImageDocument, region: Rect, polarity: Polarity) {
  const profile = Array.from({ length: Math.max(1, Math.ceil(region.width)) }, () => 0)
  const maxGray = image.bitDepth === 16 ? 65535 : 255
  for (let x = 0; x < profile.length; x += 1) { const stats = measureRect(image, { x: region.x + x, y: region.y, width: 1, height: region.height }); profile[x] = stats ? polarity === 'dark' ? maxGray - stats.meanGray : stats.meanGray : 0 }
  return profile.map((_, index) => { const start = Math.max(0, index - 3); const end = Math.min(profile.length, index + 4); return profile.slice(start, end).reduce((sum, value) => sum + value, 0) / (end - start) })
}

export function detectLaneRects(image: ImageDocument | null, region: Rect | null, laneCount: number, polarity: Polarity): Rect[] {
  if (!image || !region || region.width < 2 || region.height < 1) return []
  const count = Math.max(1, Math.min(24, Math.round(laneCount))); const profile = smoothedProfile(image, region, polarity); const minDistance = Math.max(8, Math.floor(region.width / (count * 1.7)))
  const candidates = profile.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value); const centers: number[] = []
  for (const candidate of candidates) { if (centers.every((center) => Math.abs(center - candidate.index) >= minDistance)) centers.push(candidate.index); if (centers.length === count) break }
  centers.sort((a, b) => a - b)
  if (centers.length < count) { centers.length = 0; for (let index = 0; index < count; index += 1) centers.push(Math.round((index + .5) * profile.length / count)) }
  const bounds = [0, ...centers.slice(1).map((center, index) => Math.round((centers[index] + center) / 2)), profile.length]
  return centers.map((_center, index) => ({ x: region.x + bounds[index], y: region.y, width: Math.max(1, bounds[index + 1] - bounds[index]), height: region.height }))
}

function backgroundMean(image: ImageDocument | null, background: Rect | null) { return measureRect(image, background)?.meanGray ?? null }
function corrected(stats: PixelStats | null, bgMean: number | null, polarity: Polarity) { return !stats || bgMean === null ? null : (polarity === 'dark' ? bgMean - stats.meanGray : stats.meanGray - bgMean) * stats.area }

export function calculatePairMeasurements(targetImage: ImageDocument | null, loadingImage: ImageDocument | null, lanes: LaneAssignment[], targetBackground: Rect | null, loadingBackground: Rect | null, polarity: Polarity, referenceGroup: string) {
  const targetBgMean = backgroundMean(targetImage, targetBackground); const loadingBgMean = backgroundMean(loadingImage, loadingBackground)
  const measurements: PairMeasurement[] = lanes.map((lane) => {
    const target = measureRect(targetImage, lane.targetRect); const loading = measureRect(loadingImage, lane.loadingRect); const targetCorrected = corrected(target, targetBgMean, polarity); const loadingCorrected = corrected(loading, loadingBgMean, polarity); const qc: string[] = []
    if (!targetImage) qc.push('缺少目的图片'); if (!loadingImage) qc.push('缺少内参图片'); if (targetBgMean === null) qc.push('缺少目的背景'); if (loadingBgMean === null) qc.push('缺少内参背景'); if (target?.saturated) qc.push('目的可能饱和'); if (loading?.saturated) qc.push('内参可能饱和'); if (targetCorrected !== null && targetCorrected < 0) qc.push('目的校正值为负'); if (loadingCorrected !== null && loadingCorrected <= 0) qc.push('内参校正值无效')
    const normalized = targetCorrected !== null && loadingCorrected !== null && loadingCorrected > 0 ? targetCorrected / loadingCorrected : null; if (normalized === null) qc.push('无法归一化')
    return { lane, target, loading, targetCorrected, loadingCorrected, normalized, relativeExpression: null, qc }
  })
  const referenceValues = measurements.filter((measurement) => measurement.lane.group === referenceGroup && measurement.normalized !== null).map((measurement) => measurement.normalized!); const referenceMean = referenceValues.length ? referenceValues.reduce((sum, value) => sum + value, 0) / referenceValues.length : null
  measurements.forEach((measurement) => { measurement.relativeExpression = measurement.normalized !== null && referenceMean !== null && referenceMean !== 0 ? measurement.normalized / referenceMean : null })
  return { measurements, targetBgMean, loadingBgMean, referenceMean }
}

export function summarizeByGroup(measurements: PairMeasurement[], field: 'normalized' | 'relativeExpression' = 'relativeExpression'): GroupSummary[] {
  const grouped = new Map<string, number[]>()
  for (const measurement of measurements) {
    const key = measurement.lane.group || `Lane ${measurement.lane.index}`
    const value = field === 'relativeExpression' ? measurement.relativeExpression : measurement.normalized
    if (value === null || !Number.isFinite(value)) continue
    const list = grouped.get(key) ?? []
    list.push(value)
    grouped.set(key, list)
  }
  return Array.from(grouped.entries()).map(([group, values]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const sd = values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : 0
    return { group, values, n: values.length, mean, sd, sem: values.length > 1 ? sd / Math.sqrt(values.length) : null }
  })
}

export function rotateImageData(image: ImageDocument, angleDeg: number, center: { x: number; y: number }): ImageDocument {
  const radians = angleDeg * Math.PI / 180
  const cos = Math.cos(radians); const sin = Math.sin(radians)
  const pixels = image.bitDepth === 16 ? new Uint16Array(image.width * image.height) : new Uint8Array(image.width * image.height)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dx = x - center.x; const dy = y - center.y
      const sx = center.x + dx * cos + dy * sin
      const sy = center.y - dx * sin + dy * cos
      const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(sx))); const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(sy)))
      const x1 = Math.min(image.width - 1, x0 + 1); const y1 = Math.min(image.height - 1, y0 + 1)
      const fx = Math.max(0, Math.min(1, sx - x0)); const fy = Math.max(0, Math.min(1, sy - y0))
      const a = image.pixels[y0 * image.width + x0]; const b = image.pixels[y0 * image.width + x1]; const c = image.pixels[y1 * image.width + x0]; const d = image.pixels[y1 * image.width + x1]
      const value = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
      pixels[y * image.width + x] = Math.round(value)
    }
  }
  return { ...image, pixels }
}

export function makeDemoPair() {
  const width = 760; const height = 430; const laneCenters = [105, 205, 305, 405, 505, 605]
  const create = (kind: ImageKind): ImageDocument => { const pixels = new Uint8Array(width * height); for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const noise = ((x * 17 + y * 31) % 7) - 3; let value = 216 + noise; laneCenters.forEach((lane, index) => { const dx = Math.abs(x - lane); const strength = kind === 'target' ? [42, 78, 58, 120, 92, 145][index] : 68; const yCenter = kind === 'target' ? 132 : 270; const band = Math.max(0, 1 - dx / 34) * Math.max(0, 1 - Math.abs(y - yCenter) / (kind === 'target' ? 18 : 15)); value -= band * strength }); pixels[y * width + x] = Math.max(22, Math.min(250, Math.round(value))) } return { fileName: kind === 'target' ? 'demo-target.png' : 'demo-loading-control.png', width, height, bitDepth: 8, channel: '灰度亮度', source: 'demo', pixels } }
  const targetRegion = { x: 60, y: 105, width: 590, height: 55 }; const loadingRegion = { x: 60, y: 245, width: 590, height: 50 }; const targetImage = create('target'); const loadingImage = create('loading'); const targetLanes = detectLaneRects(targetImage, targetRegion, 6, 'dark'); const loadingLanes = detectLaneRects(loadingImage, loadingRegion, 6, 'dark'); const groups = ['Control', 'Control', 'Control', 'Treatment', 'Treatment', 'Treatment']
  const lanes = targetLanes.map((targetRect, index) => ({ id: `lane-${index + 1}`, index: index + 1, targetRect, loadingRect: loadingLanes[index] ?? loadingRegion, sample: `S${index + 1}`, group: groups[index], replicate: String(index % 3 + 1) }))
  return { targetImage, loadingImage, targetRegion, loadingRegion, targetBackground: { x: 60, y: 172, width: 590, height: 30 }, loadingBackground: { x: 60, y: 310, width: 590, height: 30 }, lanes }
}
