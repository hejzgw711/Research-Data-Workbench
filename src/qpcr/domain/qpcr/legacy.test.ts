import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../../defaults'
import { parseProject, serializeProject } from '../../features/project'
import { amplificationCurve, meltingCurve, simulate } from './index'

// Captured from the unchanged legacy engine on 2026-09-13 before reference-v1 was added.
const generated = {
  cq: 18.13310522914125, tm: 85.65624591132973, plateau: 1.1542844887706805,
  slope: 0.8621955173177542, noise: 0.004, baseline: 0.01890690220298711, fwhm: 2.53,
}
const amplification = [
  { x: 1, y: 0.019254218649773672 }, { x: 10, y: 0.023324727989040644 },
  { x: 18, y: 0.10950114484696406 }, { x: 25, y: 1.1433077556326423 },
  { x: 40, y: 1.1708611049157098 },
]
const melting = [
  { x: 60, y: -0.0019106146339386391 }, { x: 80, y: -0.0018842756480491548 },
  { x: 85, y: 1.1535935079692319 }, { x: 85.8, y: 1.3742051668125954 },
  { x: 95, y: -0.0032387408077160355 },
]

function legacyProject() {
  const project = createDefaultProject()
  delete project.simulation.curveModel
  return project
}

describe('legacy numerical replay', () => {
  it('reproduces pre-change wells and raw curve points when the model field is absent', () => {
    const project = legacyProject()
    const result = simulate(project)
    const first = result.wells[0]
    expect(project.randomSeed).toBe(20260912)
    expect(first.key).toBe('g1/1/ref1/1')
    expect(first.generated).toEqual(generated)
    const amp = amplificationCurve(first, project)
    const melt = meltingCurve(first, project)
    expect(amp).toHaveLength(40)
    expect(melt).toHaveLength(176)
    expect(amplification.map(point => amp.find(actual => actual.x === point.x))).toEqual(amplification)
    expect(melting.map(point => melt.find(actual => actual.x === point.x))).toEqual(melting)
    expect(result.groups[0].folds).toEqual([1.053947434402499, 1.1111009459108738, 0.8539403432370914])
    expect(result.groups[0].deltaCqs).toEqual([5.944472146270485, 5.868285166037797, 6.248067869692406])
  })

  it('preserves a version-1 project and its exact raw curves through save/open', () => {
    const project = legacyProject()
    const oldFile = JSON.stringify({ schemaVersion: 1, simulationAlgorithmVersion: 1, project })
    const restored = parseProject(oldFile)
    const resaved = serializeProject(restored)
    expect(JSON.parse(resaved).simulationAlgorithmVersion).toBe(1)
    const replay = parseProject(resaved)
    const before = simulate(project)
    const after = simulate(replay)
    expect(after).toEqual(before)
    expect(amplificationCurve(after.wells[0], replay)).toEqual(amplificationCurve(before.wells[0], project))
    expect(meltingCurve(after.wells[0], replay)).toEqual(meltingCurve(before.wells[0], project))
  })

  it('explicit legacy-v1 selection matches an old project without a model field', () => {
    const project = legacyProject()
    const oldResult = simulate(project)
    project.simulation.curveModel = 'legacy-v1'
    const explicitResult = simulate(project)
    expect(explicitResult).toEqual(oldResult)
    expect(amplificationCurve(explicitResult.wells[0], project)).toEqual(amplificationCurve(oldResult.wells[0], legacyProject()))
    expect(JSON.parse(serializeProject(project)).simulationAlgorithmVersion).toBe(1)
  })
})
