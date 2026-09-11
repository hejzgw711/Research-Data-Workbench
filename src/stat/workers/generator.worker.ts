import { generateCandidates } from '../core/generator'
import type { GeneratorSettings } from '../models'

self.onmessage = (event: MessageEvent<GeneratorSettings>) => {
  try {
    const report = generateCandidates(event.data)
    self.postMessage({ ok: true, report })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : '生成失败' })
  }
}
