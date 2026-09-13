export interface ChartAxis { min: number; max: number; interval: number; ticks: number[] }

/** Display-only bounds. Never rounds or transforms the underlying observations. */
export function chartNumericAxis(values: readonly number[], options: { includeZero?: boolean; padding?: number; targetTicks?: number } = {}): ChartAxis {
  const { includeZero = true, padding = .08, targetTicks = 5 } = options
  let low = Infinity; let high = -Infinity
  for (const value of values) if (Number.isFinite(value)) { low = Math.min(low, value); high = Math.max(high, value) }
  if (!Number.isFinite(low)) { low = 0; high = 1 }
  if (includeZero) { low = Math.min(0, low); high = Math.max(0, high) }
  if (low === high) {
    const span = Math.abs(low) * .1 || 1
    if (includeZero) high += span
    else { low -= span; high += span }
  }
  const span = high - low
  const margin = span * Math.max(0, padding)
  const lower = includeZero && low === 0 ? 0 : low - margin
  const upper = includeZero && high === 0 ? 0 : high + margin
  const rough = (upper - lower) / Math.max(2, Math.min(10, targetTicks))
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const interval = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude
  const clean = (value: number) => Number(value.toPrecision(16))
  const min = clean(Math.floor(lower / interval) * interval)
  const max = clean(Math.ceil(upper / interval) * interval)
  const count = Math.round((max - min) / interval)
  return { min, max, interval: clean(interval), ticks: Array.from({ length: count + 1 }, (_, index) => clean(min + index * interval)) }
}

/** Compact labels, with enough precision to distinguish neighboring ticks. */
export function formatChartTick(value: number, interval?: number): string {
  if (!Number.isFinite(value)) return ''
  const step = interval && Number.isFinite(interval) ? Math.abs(interval) : undefined
  if (value === 0 || (step && Math.abs(value) < step * 1e-8)) return '0'
  const absolute = Math.abs(value)
  if (absolute >= 1e6 || absolute < .001) {
    const decimals = step ? Math.max(0, Math.min(15, Math.ceil(Math.log10(absolute) - Math.log10(step)) + 1)) : 3
    const [mantissa, exponent] = value.toExponential(decimals).split('e')
    return Number(mantissa) + 'e' + Number(exponent)
  }
  const decimals = step ? Math.max(0, Math.min(12, Math.ceil(-Math.log10(step)) + 1)) : 5
  return String(Number(value.toFixed(decimals)))
}

/** Wrap display labels without dropping their original text. CJK uses two cells. */
export function wrapChartLabel(label: string, maxChars = 14): string {
  const limit = Math.max(2, maxChars)
  const lines: string[] = []
  for (const paragraph of label.split('\n')) {
    let line = ''; let cells = 0
    for (const character of Array.from(paragraph)) {
      const size = (character.codePointAt(0) ?? 0) > 255 ? 2 : 1
      if (cells + size > limit && line) { lines.push(line); line = ''; cells = 0 }
      line += character; cells += size
    }
    lines.push(line)
  }
  return lines.join('\n')
}
