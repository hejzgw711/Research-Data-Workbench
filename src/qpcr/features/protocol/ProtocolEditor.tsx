import { useId, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { ChevronDown, ChevronUp, Thermometer } from 'lucide-react'
import type { PCRProtocol, PCRStep, ProjectUpdater, QPCRProject } from '../../models'
import { NumericInput } from '../../components/NumericInput'
import { protocolTimeline } from './timeline'
import '../panels.css'

type StepKey = 'preincubation' | 'denaturation' | 'annealing' | 'extension' | 'meltHigh' | 'meltLow' | 'meltEnd' | 'cooling'

function ProtocolSchematic({ protocol }: { protocol: PCRProtocol }) {
  const gradientId = useId()
  const labelNumber = (value: number) => value !== 0 && Math.abs(value) < 0.01 ? value.toExponential(1) : Number(value.toFixed(2)).toString()
  const stages = [
    { key: 'preincubation', name: '预变性', step: protocol.preincubation },
    { key: 'denaturation', name: '变性', step: protocol.denaturation },
    { key: 'annealing', name: protocol.mode === 'two-step' ? '退火 / 延伸' : '退火', step: protocol.annealing },
    ...(protocol.mode === 'three-step' ? [{ key: 'extension', name: '延伸', step: protocol.extension }] : []),
    { key: 'meltHigh', name: '熔解变性', step: protocol.meltHigh },
    { key: 'meltLow', name: '熔解降温', step: protocol.meltLow },
    { key: 'meltEnd', name: '连续升温', step: protocol.meltEnd },
    ...(protocol.coolingEnabled ? [{ key: 'cooling', name: '冷却', step: protocol.cooling }] : []),
  ]
  const width = 900 / stages.length
  const minimum = Math.min(30, ...stages.map(stage => stage.step.temperatureC))
  const maximum = Math.max(100, ...stages.map(stage => stage.step.temperatureC))
  const y = (temperature: number) => 50 + (maximum - temperature) / (maximum - minimum) * 130
  const positions = stages.map((stage, index) => ({ ...stage, start: 50 + width * index, rampEnd: 50 + width * (index + (stage.key === 'meltEnd' ? 0.65 : 0.18)), end: 50 + width * (index + 0.91) }))
  const points = [[50, y(37)], ...positions.flatMap(stage => [[stage.rampEnd, y(stage.step.temperatureC)], [stage.end, y(stage.step.temperatureC)]])]
  const cycleEnd = positions[protocol.mode === 'three-step' ? 3 : 2].end
  const meltStages = positions.filter(stage => stage.key.startsWith('melt'))
  return <svg className="protocol-schematic" role="img" aria-label="单循环温度程序示意，横轴按阶段排列，不代表实际时间" viewBox="0 0 1000 240">
    <defs><linearGradient id={gradientId} x1="0" x2="1"><stop offset="0%" stopColor="#269c8c" /><stop offset="100%" stopColor="#e49148" /></linearGradient></defs>
    {[40, 60, 80, 95].filter(value => value >= minimum && value <= maximum).map(value => <g key={value}><line className="protocol-guide" x1="50" x2="966" y1={y(value)} y2={y(value)} /><text className="protocol-guide-label" x="36" y={y(value) + 3} textAnchor="end">{value}°</text></g>)}
    <polyline points={points.map(point => point.join(',')).join(' ')} fill="none" stroke={`url(#${gradientId})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    {positions.map(stage => <g key={stage.key}>
      <title>{stage.name}：{stage.step.temperatureC} °C，持续 {stage.step.holdSeconds} s，升降温 {stage.step.rampRateCPerSec} °C/s</title>
      {!stage.key.startsWith('melt') && <><text className="protocol-stage-label" x={(stage.rampEnd + stage.end) / 2} y={y(stage.step.temperatureC) - 11} textAnchor="middle">{stage.name} {labelNumber(stage.step.temperatureC)}°C</text>{stage.key !== 'cooling' && <text className="protocol-stage-detail" x={(stage.rampEnd + stage.end) / 2} y={y(stage.step.temperatureC) + 22} textAnchor="middle">{labelNumber(stage.step.holdSeconds)} s · {labelNumber(stage.step.rampRateCPerSec)}°C/s</text>}</>}
      {stage.step.acquisition !== 'none' && <circle className="protocol-acquisition-marker" cx={(stage.rampEnd + stage.end) / 2} cy={y(stage.step.temperatureC)} r="5.5"><title>{stage.step.acquisition === 'single' ? '单次荧光采集' : '连续荧光采集'}</title></circle>}
    </g>)}
    <text className="protocol-stage-label" x={(meltStages[0].start + meltStages[2].end) / 2} y="23" textAnchor="middle">三阶段熔解 · {protocol.readingsPerC} readings/°C</text>
    <text className="protocol-stage-detail" x={(meltStages[0].start + meltStages[2].end) / 2} y="37" textAnchor="middle">{labelNumber(protocol.meltHigh.temperatureC)} → {labelNumber(protocol.meltLow.temperatureC)} → {labelNumber(protocol.meltEnd.temperatureC)} °C</text>
    <path className="protocol-cycle-bracket" d={`M ${positions[1].start} 211 v 4 H ${cycleEnd} v -4`} />
    <text className="protocol-cycle-caption" x={(positions[1].start + cycleEnd) / 2} y="232" textAnchor="middle">× {protocol.cycles} cycles</text>
  </svg>
}

function StepFields({ title, stepKey, protocol, update, disabled = false, acquisition = true }: {
  title: string; stepKey: StepKey; protocol: PCRProtocol; update: ProjectUpdater; disabled?: boolean; acquisition?: boolean
}) {
  const value = protocol[stepKey]
  const set = (key: keyof PCRStep, next: number | PCRStep['acquisition']) => update(project => { Object.assign(project.protocol[stepKey], { [key]: next }) })
  return <div className={`protocol-step ${disabled ? 'is-disabled' : ''}`}>
    <h4>{title}</h4>
    <div className="protocol-step-fields">
      <label className="field"><span>目标温度 °C</span><NumericInput label={`${title}目标温度`} value={value.temperatureC} min={stepKey === 'meltEnd' ? protocol.meltLow.temperatureC + 0.01 : 4} max={stepKey === 'meltLow' ? protocol.meltEnd.temperatureC - 0.01 : 100} disabled={disabled} onChange={v => set('temperatureC', v)} /></label>
      <label className="field"><span>持续时间 秒</span><NumericInput label={`${title}持续时间`} value={value.holdSeconds} min={0} max={3600} disabled={disabled} onChange={v => set('holdSeconds', v)} /></label>
      <label className="field"><span>Ramp °C/s</span><NumericInput label={`${title}升降温速率`} value={value.rampRateCPerSec} min={0.01} max={20} step="any" disabled={disabled} onChange={v => set('rampRateCPerSec', v)} /></label>
      {acquisition && <label className="field"><span>采集模式</span><select aria-label={`${title}采集模式`} disabled={disabled} value={value.acquisition} onChange={e => set('acquisition', e.target.value as PCRStep['acquisition'])}><option value="none">None · 不采集</option><option value="single">Single · 单次</option><option value="continuous">Continuous · 连续</option></select></label>}
    </div>
  </div>
}

export function ProtocolEditor({ project, update }: { project: QPCRProject; update: ProjectUpdater }) {
  const [open, setOpen] = useState(true)
  const [graphView, setGraphView] = useState<'schematic' | 'timeline'>('schematic')
  const p = project.protocol
  const timeline = useMemo(() => protocolTimeline(p), [p])
  const option = useMemo(() => ({
    animation: false,
    backgroundColor: '#ffffff',
    grid: { top: 35, right: 26, bottom: 74, left: 46 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${Number(v).toFixed(1)} °C` },
    xAxis: { type: 'value', name: '时间 / min', nameLocation: 'middle', nameGap: 29, min: 0, max: Number((timeline.totalSeconds / 60).toFixed(3)), axisLabel: { formatter: (v: number) => Number(v.toFixed(1)) }, splitLine: { show: false } },
    yAxis: { type: 'value', name: '温度 / °C', min: Math.max(0, Math.floor(Math.min(...timeline.points.map(point => point.temperature)) / 10) * 10 - 10), max: 100, splitLine: { lineStyle: { type: 'dashed', color: '#e4ece9' } } },
    dataZoom: [{ type: 'inside', filterMode: 'none' }, { type: 'slider', height: 16, bottom: 8, borderColor: '#dbe6e3', fillerColor: '#239c8824' }],
    series: [{ name: '程序温度', type: 'line', symbol: 'none', lineStyle: { width: 2, color: '#259d8c' }, data: timeline.points.map(point => [point.seconds / 60, point.temperature]), markArea: { silent: true, label: { color: '#46615b', fontSize: 11 }, data: timeline.spans.map((span, index) => [{ name: span.name, xAxis: span.start / 60, itemStyle: { color: index % 2 ? '#259d8808' : '#f3a65a12' } }, { xAxis: span.end / 60 }]) } },
      { name: '荧光采集', type: 'scatter', symbolSize: 4, itemStyle: { color: '#eaa545' }, data: timeline.acquisitions.map(point => [point.seconds / 60, point.temperature]) }],
  }), [timeline])
  const setMode = (mode: PCRProtocol['mode']) => update(next => {
    next.protocol.mode = mode
    next.protocol.annealing.acquisition = mode === 'two-step' ? 'single' : 'none'
    next.protocol.extension.acquisition = 'single'
  })
  return <section className="card protocol-editor">
    <button className="protocol-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span><strong><Thermometer size={18} /> PCR 运行条件</strong><small>{p.cycles} 循环 · {p.mode === 'two-step' ? '两步扩增' : '三步扩增'} · 熔解 {p.meltLow.temperatureC}–{p.meltEnd.temperatureC} °C</small></span>
      {open ? <ChevronUp size={19} /> : <ChevronDown size={19} />}
    </button>
    {open && <div className="protocol-body">
      <div className="protocol-preview">
        <div className="protocol-preview-title"><div><strong>温度程序预览</strong><small>{graphView === 'schematic' ? '单循环示意 · 横轴按阶段排列，不代表实际时间' : '完整时间程序 · 包含全部循环，可拖动下方滑块放大'}</small></div><span>预计 <b>{(timeline.totalSeconds / 60).toFixed(1)}</b> min</span></div>
        <div className="protocol-view-switch"><button className={graphView === 'schematic' ? 'active' : ''} aria-pressed={graphView === 'schematic'} onClick={() => setGraphView('schematic')}>单循环示意</button><button className={graphView === 'timeline' ? 'active' : ''} aria-pressed={graphView === 'timeline'} onClick={() => setGraphView('timeline')}>完整时间程序</button></div>
        {graphView === 'schematic' ? <div className="protocol-schematic-scroll"><ProtocolSchematic protocol={p} /></div> : <ReactECharts option={option} notMerge opts={{ renderer: 'svg' }} style={{ height: 275 }} />}
        <div className="protocol-legend"><span><i /> 程序温度</span><span><i className="acquisition-dot" /> 荧光采集点</span><span>初始温度 37 °C · 估算不含仪器额外等待</span></div>
      </div>
      <div className="protocol-template"><div><strong>LC96 标准模板</strong><small>可编辑温度程序 · SYBR 单通道模拟</small></div><div className="protocol-mode"><button className={`btn btn-small ${p.mode === 'two-step' ? 'active' : ''}`} aria-pressed={p.mode === 'two-step'} onClick={() => setMode('two-step')}>两步法</button><button className={`btn btn-small ${p.mode === 'three-step' ? 'active' : ''}`} aria-pressed={p.mode === 'three-step'} onClick={() => setMode('three-step')}>三步法</button></div></div>
      <div className="protocol-stages">
        <div className="protocol-stage protocol-half protocol-compact"><div className="protocol-stage-title"><span>1</span><div><strong>预变性</strong><small>Preincubation · 1 cycle</small></div></div><StepFields title="预变性" stepKey="preincubation" protocol={p} update={update} /></div>
        <div className="protocol-stage"><div className="protocol-stage-title"><span>2</span><div><strong>{p.mode === 'two-step' ? '两步' : '三步'}扩增</strong><small>Amplification · 在所选步骤采集荧光</small></div><label className="protocol-cycle-label">循环数<NumericInput label="扩增循环数" value={p.cycles} min={3} max={100} onChange={v => update(next => {
          next.protocol.cycles = Math.round(v)
          next.protocol.cqDetection.baselineEndCycle = Math.min(next.protocol.cqDetection.baselineEndCycle, next.protocol.cycles - 1)
          next.protocol.cqDetection.baselineStartCycle = Math.min(next.protocol.cqDetection.baselineStartCycle, next.protocol.cqDetection.baselineEndCycle - 1)
        })} /></label></div>
          <div className="protocol-amplification"><StepFields title="变性" stepKey="denaturation" protocol={p} update={update} /><StepFields title={p.mode === 'two-step' ? '退火 / 延伸' : '退火'} stepKey="annealing" protocol={p} update={update} />{p.mode === 'three-step' && <StepFields title="延伸" stepKey="extension" protocol={p} update={update} />}</div>
        </div>
        <div className="protocol-stage"><div className="protocol-stage-title"><span>3</span><div><strong>三阶段熔解</strong><small>Melting · 连续升温与采集</small></div></div><div className="protocol-melting"><StepFields title="熔解变性" stepKey="meltHigh" protocol={p} update={update} /><StepFields title="熔解降温" stepKey="meltLow" protocol={p} update={update} /><div><StepFields title="连续升温" stepKey="meltEnd" protocol={p} update={update} /><label className="field protocol-readings"><span>采集密度 readings / °C</span><NumericInput label="熔解采集密度" value={p.readingsPerC} min={1} max={20} onChange={v => update(next => { next.protocol.readingsPerC = Math.round(v) })} /></label></div></div>
          {p.meltLow.temperatureC >= p.meltEnd.temperatureC && <p className="notice">熔解结束温度需高于起始温度，才能绘制有效温区。</p>}
        </div>
        <div className="protocol-stage protocol-half protocol-compact"><div className="protocol-stage-title"><span>4</span><div><strong>冷却</strong><small>Cooling · 可选</small></div><label className="protocol-enable"><input type="checkbox" checked={p.coolingEnabled} onChange={e => update(next => { next.protocol.coolingEnabled = e.target.checked })} />启用</label></div><StepFields title="冷却" stepKey="cooling" protocol={p} update={update} disabled={!p.coolingEnabled} /></div>
        <div className="protocol-stage protocol-half"><div className="protocol-stage-title"><span>M</span><div><strong>测量设置</strong><small>荧光通道与反应参数</small></div><select className="protocol-channel" aria-label="荧光通道" value={p.channel} onChange={e => update(next => { next.protocol.channel = e.target.value })}><option>SYBR Green</option><option>FAM</option><option>HEX</option><option>ROX</option></select></div><div className="protocol-measurement-fields">
          <label className="field"><span>反应体积 μl</span><NumericInput label="反应体积" value={p.volume} min={1} max={100} onChange={v => update(next => { next.protocol.volume = v })} /></label>
          <label className="field"><span>积分模式</span><select aria-label="积分模式" value={p.acquisitionMode} onChange={e => update(next => { next.protocol.acquisitionMode = e.target.value as PCRProtocol['acquisitionMode'] })}><option value="dynamic">Dynamic</option><option value="fixed">Fixed</option></select></label>
          <label className="field"><span>Quant Factor</span><NumericInput label="定量因子" value={p.quantFactor} min={0.01} max={1000} step="any" onChange={v => update(next => { next.protocol.quantFactor = v })} /></label>
          <label className="field"><span>Melt Factor</span><NumericInput label="熔解因子" value={p.meltFactor} min={0.01} max={100} step="any" onChange={v => update(next => { next.protocol.meltFactor = v })} /></label>
        </div><p className="muted protocol-metadata-note">通道、体积与积分模式作为实验记录保存并导出；不模拟仪器硬件差异。</p></div>
      </div>
      <div className="protocol-detection"><strong>Cq 检测阈值</strong><label className="field"><span>阈值模式</span><select aria-label="Cq 阈值模式" value={p.cqDetection.mode} onChange={e => update(next => { next.protocol.cqDetection.mode = e.target.value as PCRProtocol['cqDetection']['mode'] })}><option value="baseline-delta-f">基线校正 ΔF</option><option value="fixed-threshold">固定荧光阈值</option></select></label><label className="field"><span>阈值 ΔF</span><NumericInput label="Cq 荧光阈值" value={p.cqDetection.threshold} min={0.000001} max={10} step="any" onChange={v => update(next => { next.protocol.cqDetection.threshold = v })} /></label><label className="field"><span>基线开始循环</span><NumericInput label="基线开始循环" value={p.cqDetection.baselineStartCycle} min={1} max={p.cqDetection.baselineEndCycle - 1} onChange={v => update(next => { next.protocol.cqDetection.baselineStartCycle = Math.round(v) })} /></label><label className="field"><span>基线结束循环</span><NumericInput label="基线结束循环" value={p.cqDetection.baselineEndCycle} min={p.cqDetection.baselineStartCycle + 1} max={p.cycles - 1} onChange={v => update(next => { next.protocol.cqDetection.baselineEndCycle = Math.round(v) })} /></label></div>
      <p className="muted protocol-metadata-note">Cq 为生成或手动输入值；阈值与基线区间校准模拟曲线，不表示从真实测量曲线拟合 Cq。</p>
    </div>}
  </section>
}
