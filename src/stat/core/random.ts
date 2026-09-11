import seedrandom from 'seedrandom'

export function createRandomSeed() {
  const values = new Uint32Array(4)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('')
}

export function scopedRng(seed: string, ...scope: Array<string | number>) {
  return seedrandom([seed, ...scope].join('::'))
}

export function uniform(rng: seedrandom.PRNG, min: number, max: number) {
  return min + rng.quick() * (max - min)
}

export function normal(rng: seedrandom.PRNG, mean = 0, sd = 1) {
  const u1 = Math.max(rng.quick(), Number.EPSILON)
  const u2 = rng.quick()
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

export function formatValue(value: number, type: 'decimal' | 'integer', decimals: number | null) {
  if (type === 'integer') return Math.round(value)
  if (decimals === null) return value
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
