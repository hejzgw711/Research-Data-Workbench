import type { PCRProtocol, PCRStep } from '../../models'

export interface TemperaturePoint { seconds: number; temperature: number }
export interface ProtocolSpan { name: string; start: number; end: number }

export function protocolTimeline(protocol: PCRProtocol) {
  let seconds = 0
  let temperature = 37
  const points: TemperaturePoint[] = [{ seconds, temperature }]
  const acquisitions: TemperaturePoint[] = []
  const spans: ProtocolSpan[] = []
  const append = (step: PCRStep) => {
    const startSeconds = seconds
    const startTemperature = temperature
    seconds += Math.abs(step.temperatureC - temperature) / Math.max(step.rampRateCPerSec, 0.01)
    temperature = step.temperatureC
    points.push({ seconds, temperature })
    if (step.acquisition === 'continuous') {
      const readingCount = Math.min(1000, Math.max(1, Math.ceil(Math.abs(temperature - startTemperature) * protocol.readingsPerC)))
      for (let i = 1; i <= readingCount; i++) acquisitions.push({
        seconds: startSeconds + (seconds - startSeconds) * i / readingCount,
        temperature: startTemperature + (temperature - startTemperature) * i / readingCount,
      })
    }
    seconds += step.holdSeconds
    points.push({ seconds, temperature })
    if (step.acquisition === 'single') acquisitions.push({ seconds, temperature })
  }
  const stage = (name: string, callback: () => void) => {
    const start = seconds
    callback()
    spans.push({ name, start, end: seconds })
  }
  stage('预变性', () => append(protocol.preincubation))
  stage(`扩增 × ${protocol.cycles}`, () => {
    for (let cycle = 0; cycle < protocol.cycles; cycle++) {
      append(protocol.denaturation)
      append(protocol.annealing)
      if (protocol.mode === 'three-step') append(protocol.extension)
    }
  })
  stage('熔解', () => {
    append(protocol.meltHigh)
    append(protocol.meltLow)
    append(protocol.meltEnd)
  })
  if (protocol.coolingEnabled) stage('冷却', () => append(protocol.cooling))
  return { points, acquisitions, spans, totalSeconds: seconds }
}
