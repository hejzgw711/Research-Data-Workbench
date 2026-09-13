import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sun, Moon, FolderOpen, Save, Download, Shuffle, Play, Plus, Trash2, Grid3X3, FlaskConical, WandSparkles, RotateCcw, ChevronDown, Check, X, Settings2 } from 'lucide-react'
import type { ExperimentGroup, GeneConfig, QPCRProject, SimulationResult } from './models'
import { createDefaultProject } from './defaults'
import { simulate } from './domain/qpcr'
import { NumericInput } from './components/NumericInput'
import { ResultsPanel, formatNumber } from './components/ResultsPanel'
import { AdvancedPlate } from './features/plate/AdvancedPlate'
import { ProtocolEditor } from './features/protocol/ProtocolEditor'
import { parseProject, serializeProject } from './features/project'
import { downloadBlob, exportXlsx, exportCsvZip } from './features/export'
import { dataProjectName } from './features/export/raw'
import './features/panels.css'
import './workbench.css'

const AUTOSAVE_KEY = 'qpcr-full-flow-project-v1'
const emptyResult: SimulationResult = { wells: [], samples: [], groups: [], comparisons: [], qc: [], totalWells: 0, plateCount: 1 }
function initialProject(): QPCRProject {
  try { const saved = localStorage.getItem(AUTOSAVE_KEY); if (saved) return parseProject(saved) } catch { /* A corrupt autosave must not prevent opening the workspace. */ }
  return createDefaultProject()
}
function nextId(prefix: string, ids: string[]) { let i = 1; while (ids.includes(`${prefix}${i}`)) i++; return `${prefix}${i}` }
function newSeed() { return crypto.getRandomValues(new Uint32Array(1))[0] }
function requiredWells(project: QPCRProject) { return project.groups.reduce((sum, group) => sum + (project.replicateMode === 'biological' ? group.biologicalReplicates : 1) * group.technicalReplicates * project.genes.length, 0) }

export default function App() {
  const [project, setProject] = useState<QPCRProject>(initialProject)
  const embedded = window.parent !== window
  const [hostTheme, setHostTheme] = useState<'light' | 'dark'>('light')
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null)
  const [tab, setTab] = useState<'groups' | 'plate'>('groups')
  const [targetId, setTargetId] = useState(project.genes.find(g => g.type === 'target')?.id ?? 'target1')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showComparisons, setShowComparisons] = useState(project.theme === 'dark')
  const [comparisonLeft, setComparisonLeft] = useState(project.groups[0]?.id ?? '')
  const [comparisonRight, setComparisonRight] = useState(project.groups[1]?.id ?? '')
  const [resetConfirm, setResetConfirm] = useState(false)
  const [autosaveLabel, setAutosaveLabel] = useState('自动保存在当前浏览器')
  const openRef = useRef<HTMLInputElement>(null)
  const notify = (text: string) => setToast(text)
  const update = (recipe: (draft: QPCRProject) => void) => setProject(current => {
    const draft = structuredClone(current); recipe(draft)
    if (requiredWells(draft) > 9600) { setToast('当前配置超过 9,600 孔，请减少分组或重复数。'); return current }
    for (const map of [draft.manualCq, draft.manualOverrides]) {
      for (const key of Object.keys(map)) {
        const [groupId, bio, geneId, tech] = key.split('/')
        const group = draft.groups.find(g => g.id === groupId)
        if (!group || !draft.genes.some(g => g.id === geneId) || Number(bio) > (draft.replicateMode === 'biological' ? group.biologicalReplicates : 1) || Number(tech) > group.technicalReplicates) delete map[key]
      }
    }
    return draft
  })
  const calculated = useMemo(() => {
    try { return { result: simulate(project), error: '' } }
    catch (error) { return { result: emptyResult, error: error instanceof Error ? error.message : '请检查实验设置' } }
  }, [project])
  const result = calculated.result
  const targets = project.genes.filter(g => g.type === 'target')
  const activeTargetId = targets.some(g => g.id === targetId) ? targetId : targets[0]?.id ?? ''
  useEffect(() => {
    if (!embedded) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (event.data?.type === 'workbench-theme' && (event.data.theme === 'light' || event.data.theme === 'dark')) setHostTheme(event.data.theme)
    }
    window.addEventListener('message', onMessage)
    try { setToolbarTarget(window.parent.document.getElementById('qpcr-toolbar-slot')) } catch { /* Keep local actions when not embedded in the same-origin workbench. */ }
    window.parent.postMessage({ type: 'qpcr-ready' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [embedded])
  useEffect(() => { document.documentElement.dataset.theme = embedded ? hostTheme : project.theme }, [embedded, hostTheme, project.theme])
  useEffect(() => {
    const timer = setTimeout(() => {
      let serialized: string
      try { serialized = serializeProject(project) } catch { setAutosaveLabel('当前设置未保存：请补全名称或检查参数范围'); return }
      try { localStorage.setItem(AUTOSAVE_KEY, serialized); setAutosaveLabel('自动保存在当前浏览器') } catch { setAutosaveLabel('浏览器存储不可用，请使用“保存”下载项目') }
    }, 400)
    return () => clearTimeout(timer)
  }, [project])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5500); return () => clearTimeout(timer) }, [toast])

  const editGroup = (id: string, recipe: (group: ExperimentGroup) => void) => update(p => { const group = p.groups.find(g => g.id === id); if (group) recipe(group) })
  const editGene = (id: string, recipe: (gene: GeneConfig) => void) => update(p => { const gene = p.genes.find(g => g.id === id); if (gene) recipe(gene) })
  const addGroup = () => update(p => {
    const id = nextId('g', p.groups.map(g => g.id))
    const control = p.groups.find(g => g.isCalibrator)!
    const group: ExperimentGroup = { id, name: `Group ${p.groups.length + 1}`, isCalibrator: false, biologicalReplicates: control.biologicalReplicates, technicalReplicates: control.technicalReplicates, technicalCqSD: control.technicalCqSD, targetFoldByGene: Object.fromEntries(p.genes.filter(g => g.type === 'target').map(g => [g.id, { mean: 2, sd: 0.3, sdMode: 'manual' as const }])) }
    p.groups.push(group)
    p.comparisons.push({ id: nextId('c', p.comparisons.map(c => c.id)), leftGroupId: control.id, rightGroupId: id })
  })
  const removeGroup = (id: string) => update(p => {
    p.groups = p.groups.filter(g => g.id !== id)
    if (!p.groups.some(g => g.isCalibrator)) p.groups[0].isCalibrator = true
    p.comparisons = p.comparisons.filter(c => c.leftGroupId !== id && c.rightGroupId !== id)
    for (const map of [p.manualOverrides, p.manualCq, p.rowSeeds]) for (const key of Object.keys(map)) if (key.startsWith(`${id}/`)) delete map[key]
  })
  const addGene = () => update(p => {
    const id = nextId('target', p.genes.map(g => g.id))
    p.genes.push({ id, name: `Target ${targets.length + 1}`, type: 'target', nominalCq: 24, tmC: 83.5, primerConcentration: 0.2, meltFwhmC: 2.53 })
    p.groups.forEach(g => { g.targetFoldByGene[id] = { mean: g.isCalibrator ? 1 : 2, sd: 0.3, sdMode: 'auto' } })
    setTargetId(id)
  })
  const removeGene = (id: string) => update(p => {
    p.genes = p.genes.filter(g => g.id !== id)
    p.groups.forEach(g => { delete g.targetFoldByGene[id] })
    for (const key of Object.keys(p.rowSeeds)) if (key.endsWith(`/${id}`)) delete p.rowSeeds[key]
    for (const map of [p.manualCq, p.manualOverrides]) for (const key of Object.keys(map)) if (key.split('/')[2] === id) delete map[key]
  })
  const defaultComparisons = () => update(p => {
    const control = p.groups.find(g => g.isCalibrator)!
    p.comparisons = p.groups.filter(g => !g.isCalibrator).map((g, i) => ({ id: `c${i + 1}`, leftGroupId: control.id, rightGroupId: g.id }))
  })
  const addComparison = () => {
    const left = project.groups.some(g => g.id === comparisonLeft) ? comparisonLeft : project.groups[0].id
    const right = project.groups.some(g => g.id === comparisonRight) ? comparisonRight : project.groups[1]?.id
    if (!right || left === right) { notify('请选择两个不同的分组'); return }
    if (project.comparisons.some(c => [c.leftGroupId, c.rightGroupId].includes(left) && [c.leftGroupId, c.rightGroupId].includes(right))) { notify('该组对已添加'); return }
    update(p => { p.comparisons.push({ id: nextId('c', p.comparisons.map(c => c.id)), leftGroupId: left, rightGroupId: right }) })
  }
  const openProject = async (file: File) => {
    try {
      if (file.size > 5_000_000) throw new Error('项目文件过大（上限 5 MB）')
      const loaded = parseProject(await file.text()); setProject(loaded); setTargetId(loaded.genes.find(g => g.type === 'target')!.id)
      setComparisonLeft(loaded.groups[0].id); setComparisonRight(loaded.groups[1]?.id ?? loaded.groups[0].id)
      notify(`已打开项目：${loaded.name}`)
    } catch (error) { notify(`无法打开项目：${error instanceof Error ? error.message : String(error)}`) }
  }
  const saveProject = () => {
    const name = dataProjectName(project)
    try { downloadBlob(serializeProject({ ...project, name }), `${name.replace(/[<>:"/\\|?*]/g, '_')}.qpcr.json`, 'application/json'); notify('项目已保存，包含参数、种子及逐孔微调') }
    catch (error) { notify(String(error)) }
  }
  const exportData = async (format: 'xlsx' | 'csv') => {
    setBusy(true)
    try { await (format === 'xlsx' ? exportXlsx(project, result) : exportCsvZip(project, result)); notify(format === 'xlsx' ? 'ZIP 已导出：分析 XLSX ＋ 每块板的模拟原始数据 XLSX' : 'CSV ZIP 已导出，包含每块板的模拟原始数据') }
    catch (error) { notify(`导出失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }
  const setInputMode = (mode: QPCRProject['inputMode']) => update(p => {
    if (mode === 'manual' && p.inputMode !== 'manual') p.manualCq = Object.fromEntries(result.wells.map(w => [w.key, w.values.cq]))
    p.inputMode = mode
  })
  const groupSelection = (value: string, onChange: (id: string) => void, label: string) => <select value={project.groups.some(g => g.id === value) ? value : project.groups[0].id} aria-label={label} onChange={e => onChange(e.target.value)}>{project.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>

  const toolbar = <div className={`toolbar-actions${toolbarTarget ? ' qpcr-global-actions' : ''}`} aria-label="qPCR 全局操作">
        <button className="btn btn-reset" title="新建实验，恢复默认设置" onClick={() => setResetConfirm(true)}><RotateCcw size={15}/>新建实验</button>
        <button className="btn" onClick={() => openRef.current?.click()}><FolderOpen size={15}/>打开</button><button className="btn" onClick={saveProject}><Save size={15}/>保存</button>
        <button className="btn btn-primary" onClick={() => { update(p => { p.randomSeed = newSeed() }); notify(project.inputMode === 'manual' ? '曲线随机种子已更新；手填 Cq 保持不变' : '已更换随机种子并生成新一批模拟数据') }}><Shuffle size={16}/>换一批数据</button>
        <button className="btn" onClick={() => { setProject(p => ({ ...p })); notify('已按当前种子重新模拟，相同参数的结果可复现') }} title="按当前种子重新生成"><Play size={15}/>模拟</button>
        {!embedded && <button className="btn theme-icon" aria-label={project.theme === 'light' ? '切换为深色主题' : '切换为浅色主题'} title={project.theme === 'light' ? '切换为深色主题' : '切换为浅色主题'} onClick={() => update(p => { p.theme = p.theme === 'light' ? 'dark' : 'light' })}>{project.theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</button>}
        <button className="btn btn-export" title="下载 ZIP：分析工作簿＋逐板模拟原始数据工作簿" disabled={busy || !!calculated.error} onClick={() => exportData('xlsx')}><Download size={15}/>{busy ? '导出中…' : 'XLSX＋原始数据'}</button><button className="btn" title="包含分析表和逐板模拟原始数据 CSV" disabled={busy || !!calculated.error} onClick={() => exportData('csv')}><Download size={14}/>CSV ZIP</button>
    </div>

  return <div className={`app-shell${toolbarTarget ? ' with-host-toolbar' : ''}`}>
    {toolbarTarget && createPortal(toolbar, toolbarTarget)}
    <header className="app-header"><div className="brand"><div><div className="eyebrow">qRT-PCR DATA STUDIO</div><h1>qRT-PCR 分组模拟工作台</h1><p className="brand-caption">分组 qRT-PCR 合成项目 · 测量链模拟 · 浏览器本地计算</p></div></div>
      {!toolbarTarget && toolbar}
      <input ref={openRef} type="file" accept=".json,.qpcr" hidden aria-label="打开项目文件" onChange={e => { const file = e.target.files?.[0]; if (file) void openProject(file); e.target.value = '' }}/>
    <section className="project-toolbar" aria-label="项目工具栏">
      <label className="field project-name"><span>项目名称</span><input aria-label="项目名称" value={project.name} maxLength={100} onChange={e => update(p => { p.name = e.target.value })}/></label>
      <div className="experiment-count"><span>所需孔数</span><strong data-testid="well-count">{requiredWells(project)} <small>孔</small></strong></div>
      <div className="experiment-count"><span>自动排板</span><strong>{Math.max(1, Math.ceil(requiredWells(project) / 96))} × 96<small>孔</small></strong></div>
      <label className="field seed-input"><span>随机种子</span><NumericInput value={project.randomSeed} label="随机种子" min={0} max={4294967295} onChange={v => update(p => { p.randomSeed = Math.round(v) })}/></label>
      <span className="synthetic-badge">合成数据</span>
    </section>
    </header>
    <nav className="main-tabs"><button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}><FlaskConical size={16}/>分组模拟</button><button className={tab === 'plate' ? 'active' : ''} onClick={() => setTab('plate')}><Grid3X3 size={16}/>高级孔板</button><span className="tab-note">模拟数据 · 教学与软件测试</span></nav>
    {calculated.error && <div className="notice error" role="alert">{calculated.error}</div>}
    {tab === 'groups' ? <main className="group-page">
      <section className="card generation-card"><div className="generation-title"><h2>生成模式</h2><span className="muted small">从表达量分布构建 Cq 测量链</span></div>
        <div className="control-line"><span className="line-label">输入方式</span><div className="segmented"><button className={project.inputMode === 'distribution' ? 'active' : ''} onClick={() => setInputMode('distribution')}>均值 / SD 分布</button><button className={project.inputMode === 'manual' ? 'active' : ''} onClick={() => setInputMode('manual')}>逐孔手动输入</button></div></div>
        <div className="control-line"><span className="line-label">生成策略</span><div className="segmented"><button className={project.simulation.preset === 'realistic' ? 'active' : ''} onClick={() => update(p => { p.simulation.preset = 'realistic' })}>测量链真实性</button><button className={project.simulation.preset === 'precision' ? 'active' : ''} onClick={() => update(p => { p.simulation.preset = 'precision' })}>精确验证</button></div><span className="muted small">波动</span><div className="segmented">{(['low', 'medium', 'high'] as const).map((value, i) => <button key={value} className={project.simulation.noiseLevel === value ? 'active' : ''} onClick={() => update(p => { p.simulation.noiseLevel = value })}>{['低', '中', '高'][i]}</button>)}</div><button className={`btn btn-small ${showAdvanced ? 'selected' : ''}`} onClick={() => setShowAdvanced(!showAdvanced)}><Settings2 size={14}/>高级参数<ChevronDown size={13}/></button></div>
        <div className="control-line curve-model-line"><label className="line-label" htmlFor="curve-model">曲线波动</label><select id="curve-model" aria-label="曲线波动模型" value={project.simulation.curveModel ?? 'legacy-v1'} onChange={e => update(p => { p.simulation.curveModel = e.target.value as 'legacy-v1' | 'reference-v1' })}><option value="reference-v1">参考数据波动 · 新模型</option><option value="legacy-v1">旧版曲线 · 保持复现</option></select><span className="small muted">{project.simulation.curveModel === 'reference-v1' ? '参考下机数据的波动特征，独立生成模拟曲线' : '当前保留旧版结果；选择新模型后应用参考波动'}</span></div>
        <div className="model-note"><span>扩增模型 <strong>阈值对齐 Sigmoid</strong></span><span>熔解模型 <strong>{project.simulation.curveModel === 'reference-v1' ? '非对称主峰' : 'Gaussian 主峰'}</strong></span><span className="muted">导出自动附带模拟原始数据 · 非仪器专有文件</span></div>
        {showAdvanced && <div className="advanced-settings"><div className="fields four">{([
          ['referenceCqSD', '内参生物波动 SD', 0, 3], ['fluorescenceNoise', '荧光噪声 SD', 0, 0.2], ['tmSD', 'Tm 波动 SD / °C', 0, 2], ['cqWarningSD', 'Cq SD 警告阈值', 0, 2], ['cqFailSD', 'Cq SD 异常阈值', 0, 3], ['tmWarning', 'Tm 警告偏差 / °C', 0, 3], ['tmFail', 'Tm 异常偏差 / °C', 0, 5],
        ] as const).map(([key, label, min, max]) => <label className="field" key={key}><span>{label}</span><NumericInput value={project.simulation[key]} label={label} min={min} max={max} step="any" onChange={v => update(p => { p.simulation[key] = v })}/></label>)}</div><p className="small muted">精确验证模式减小测量噪声；分布均值/SD 为抽样设定，有限样本的实际结果会有偏差。</p></div>}
      </section>
      <section className="card threshold-strip" aria-label="荧光阈值快捷设置"><div><h2>荧光阈值</h2><span className="muted small">曲线模型的阈值对齐设置</span></div><label className="field"><span>阈值模式</span><select aria-label="快捷阈值模式" value={project.protocol.cqDetection.mode} onChange={e => update(p => { p.protocol.cqDetection.mode = e.target.value as 'baseline-delta-f' | 'fixed-threshold' })}><option value="baseline-delta-f">基线校正 ΔF</option><option value="fixed-threshold">固定阈值</option></select></label><label className="field"><span>荧光阈值 ΔF</span><NumericInput label="快捷荧光阈值" value={project.protocol.cqDetection.threshold} min={0.000001} max={100} step="any" onChange={v => update(p => { p.protocol.cqDetection.threshold = v })}/></label><p>基线区间：Cycle {project.protocol.cqDetection.baselineStartCycle}–{project.protocol.cqDetection.baselineEndCycle}<br/>Cq 为模拟或手填值，未从带噪曲线重新拟合</p></section>
      <div className="workspace"><div className="configuration-column">
      <section className="card groups-card"><div className="section-heading"><div><span className="section-number">1</span><h2>实验分组</h2></div><button className="btn btn-small" onClick={addGroup} disabled={project.groups.length >= 48}><Plus size={14}/>添加组</button></div>
        <div className="design-options"><button className={`design-option ${project.replicateMode === 'technical' ? 'active' : ''}`} onClick={() => update(p => { p.replicateMode = 'technical' })}><strong>技术复孔设计</strong><span>同一样本的重复测量 · 仅作预览</span></button><button className={`design-option ${project.replicateMode === 'biological' ? 'active' : ''}`} onClick={() => update(p => { p.replicateMode = 'biological' })}><strong>生物学重复设计 <small>（含技术复孔）</small></strong><span>先合并复孔，再按独立样本统计</span></button><div className="design-summary"><strong>{requiredWells(project)} 实验孔 · {result.plateCount} 板</strong><span>{project.replicateMode === 'biological' ? '统计单位：独立生物样本' : '技术复孔仅用于预览'}<br/>{project.groups.length} 组 × {project.genes.length} 个基因</span></div></div>
        <div className="table-scroll"><table className="editor-table group-table"><thead><tr><th>对照</th><th>分组名称</th>{project.replicateMode === 'biological' && <th>生物学 n</th>}<th>技术复孔</th><th>Cq 技术波动 SD</th><th/></tr></thead><tbody>{project.groups.map(group => <tr key={group.id}><td><input type="radio" aria-label={`设 ${group.name} 为对照`} name="calibrator" checked={group.isCalibrator} onChange={() => update(p => { p.groups.forEach(g => { g.isCalibrator = g.id === group.id }); p.groups.find(g => g.id === group.id)!.targetFoldByGene = Object.fromEntries(targets.map(t => [t.id, { ...group.targetFoldByGene[t.id], mean: 1 }])) })}/></td><td><input aria-label={`分组名称 ${group.id}`} value={group.name} maxLength={40} onChange={e => editGroup(group.id, g => { g.name = e.target.value })}/></td>{project.replicateMode === 'biological' && <td><NumericInput value={group.biologicalReplicates} min={1} max={100} label={`${group.name} 生物学重复数`} onChange={v => editGroup(group.id, g => { g.biologicalReplicates = Math.round(v) })}/></td>}<td><NumericInput value={group.technicalReplicates} min={1} max={12} label={`${group.name} 技术复孔数`} onChange={v => editGroup(group.id, g => { g.technicalReplicates = Math.round(v) })}/></td><td><NumericInput value={group.technicalCqSD} min={0} max={3} label={`${group.name} Cq 技术波动 SD`} onChange={v => editGroup(group.id, g => { g.technicalCqSD = v })}/></td><td><button className="icon-button delete" aria-label={`删除 ${group.name}`} disabled={project.groups.length <= 2} onClick={() => removeGroup(group.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table></div>
        <div className="section-foot"><span><span className="tiny-dot"/>{project.groups.length} 组 · {project.genes.length} 个基因</span><span>每个样本独立测定内参与目的基因</span></div>
      </section>
      <section className="card"><div className="section-heading"><div><span className="section-number">2</span><h2>检测基因</h2></div><button className="btn btn-small" onClick={addGene} disabled={project.genes.length >= 25}><Plus size={14}/>目的基因</button></div><p className="section-description">校准 Cq 决定基线；Tm 和峰宽决定该基因的熔解曲线。</p>
        <div className="gene-grid">{project.genes.map(gene => <div key={gene.id} className={`gene-card ${gene.type === 'reference' ? 'reference' : ''}`}><div className="gene-header"><span>{gene.type === 'reference' ? '内参基因' : '目的基因'}</span>{gene.type === 'target' && <button className="icon-button delete" aria-label={`删除基因 ${gene.name}`} disabled={targets.length <= 1} onClick={() => removeGene(gene.id)}><Trash2 size={13}/></button>}</div><input className="gene-name" aria-label={`基因名称 ${gene.id}`} value={gene.name} maxLength={32} onChange={e => editGene(gene.id, g => { g.name = e.target.value })}/>{([
          ['nominalCq', '校准 Cq', 1, 45], ['tmC', 'Tm / °C', 40, 100], ['primerConcentration', '引物浓度 / μM', 0.01, 10], ['meltFwhmC', '主峰 FWHM / °C', 0.1, 15],
        ] as const).map(([key, label, min, max]) => <label className="field" key={key}><span>{label}</span><NumericInput value={gene[key]} label={`${gene.name} ${label}`} min={min} max={max} step="any" onChange={v => editGene(gene.id, g => { g[key] = v })}/></label>)}</div>)}</div>
      </section>
      {project.inputMode === 'distribution' ? <section className="card"><div className="section-heading"><div><span className="section-number">3</span><h2>目标倍数矩阵</h2></div><span className="small muted">2⁻ΔΔCq</span></div><p className="section-description">设置表达倍数的抽样均值和 SD；实际值由最终 Cq 回算。</p><div className="gene-tabs">{targets.map(g => <button key={g.id} className={activeTargetId === g.id ? 'active' : ''} onClick={() => setTargetId(g.id)}>{g.name}</button>)}</div>
        <div className="table-scroll"><table className="editor-table fold-table"><thead><tr><th>分组</th><th>目标均值</th><th>抽样 SD</th><th>实际均值 / SD / 几何均值</th><th/></tr></thead><tbody>{project.groups.map(group => {
          const fold = group.targetFoldByGene[activeTargetId] ?? { mean: 1, sd: 0.15, sdMode: 'auto' }
          const actual = result.groups.find(g => g.groupId === group.id && g.geneId === activeTargetId)
          return <tr key={group.id}><th>{group.name}{group.isCalibrator && <span className="control-tag">对照</span>}</th><td><NumericInput value={group.isCalibrator ? 1 : fold.mean} label={`${group.name} 目标倍数均值`} min={0.0001} max={10000} disabled={group.isCalibrator} onChange={v => editGroup(group.id, g => { g.targetFoldByGene[activeTargetId].mean = v })}/></td><td><div className="sd-control"><select aria-label={`${group.name} SD 模式`} value={fold.sdMode} onChange={e => editGroup(group.id, g => { g.targetFoldByGene[activeTargetId].sdMode = e.target.value as 'auto' | 'manual' })}><option value="auto">自动 SD</option><option value="manual">手动 SD</option></select>{fold.sdMode === 'manual' && <NumericInput value={fold.sd} label={`${group.name} 抽样 SD`} min={0} max={10000} onChange={v => editGroup(group.id, g => { g.targetFoldByGene[activeTargetId].sd = v })}/>}</div></td><td><div className="actual-summary"><strong>{formatNumber(actual?.mean)}</strong><span>SD {formatNumber(actual?.sd)} <i/> 几何 {formatNumber(actual?.geometricMean)}</span></div></td><td><button className="icon-button" aria-label={`重新模拟 ${group.name}`} title="只更换该组该目的基因的表达抽样" onClick={() => update(p => { const key = `${group.id}/${activeTargetId}`; p.rowSeeds[key] = (p.rowSeeds[key] ?? 0) + 1 })}><WandSparkles size={17}/></button></td></tr>
        })}</tbody></table></div>
      </section> : <section className="card"><div className="section-heading"><div><span className="section-number">3</span><h2>逐孔手动输入 Cq</h2></div><span className="pill">{result.wells.length} 孔</span></div><p className="section-description">输入各孔 Cq 后实时计算。排除孔与微调可在“高级孔板”中调整。</p><div className="table-scroll manual-table"><table className="editor-table"><thead><tr><th>孔位</th><th>分组 / 样本</th><th>基因</th><th>技术复孔</th><th>Cq</th></tr></thead><tbody>{result.wells.map(well => <tr key={well.key}><th>P{well.plateIndex + 1} · {well.wellId}</th><td>{project.groups.find(g => g.id === well.groupId)?.name} / B{well.biologicalReplicate}</td><td>{project.genes.find(g => g.id === well.geneId)?.name}</td><td>R{well.technicalReplicate}</td><td><NumericInput value={project.manualCq[well.key] ?? NaN} label={`手动 Cq ${well.id}`} min={1} max={50} step="any" onChange={v => update(p => { p.manualCq[well.key] = v; if (p.manualOverrides[well.key]) delete p.manualOverrides[well.key].cq })}/></td></tr>)}</tbody></table></div></section>}
      <section className="card comparison-card">
        <button className="comparison-toggle" aria-label="统计比较" aria-expanded={showComparisons} aria-controls="comparison-settings" onClick={() => setShowComparisons(!showComparisons)}><span className="section-number">4</span><span><strong>统计比较</strong><small>Welch 双侧 t 检验 · 基于 ΔCq · {project.comparisons.length} 项比较</small></span><ChevronDown size={18} style={{ transform: showComparisons ? 'rotate(180deg)' : undefined }}/></button>
        <div id="comparison-settings" hidden={!showComparisons}>
          <p className="section-description">仅显示已添加的组对；所有目的基因共用比较设置。</p>
          <div className="comparison-builder">{groupSelection(comparisonLeft, setComparisonLeft, '比较左侧分组')}<span className="muted">vs</span>{groupSelection(comparisonRight, setComparisonRight, '比较右侧分组')}<button className="btn btn-small" onClick={addComparison}><Plus size={14}/>添加比较</button><button className="btn btn-small" onClick={defaultComparisons}><RotateCcw size={12}/>对照组比较</button></div>
          <div className="comparison-tags">{project.comparisons.map(c => <div key={c.id} className="comparison-tag"><span>{project.groups.find(g => g.id === c.leftGroupId)?.name} <span className="muted">vs</span> {project.groups.find(g => g.id === c.rightGroupId)?.name}</span><button className="icon-button" aria-label={`删除比较 ${c.id}`} onClick={() => update(p => { p.comparisons = p.comparisons.filter(x => x.id !== c.id) })}><X size={13}/></button></div>)}</div>
          <label className="inline-field"><span>多重比较</span><select aria-label="多重比较校正" value={project.simulation.correction} onChange={e => update(p => { p.simulation.correction = e.target.value as 'none' | 'holm' })}><option value="holm">Holm 校正</option><option value="none">不校正（原始 p）</option></select></label>
        </div>
      </section>
      <ProtocolEditor project={project} update={update}/>
    </div><ResultsPanel project={project} result={result} geneId={activeTargetId} onGeneChange={setTargetId} notify={notify}/></div></main> : <main><AdvancedPlate project={project} result={result} update={update} notify={notify}/></main>}
    <footer><span><Check size={13}/> {autosaveLabel} · 模拟数据仅用于教学与测试</span><div><span>qRT-PCR Data Studio · 工作台集成版</span></div></footer>
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" onClick={() => setToast('')} aria-label="关闭提示"><X size={15}/></button></div>}
    {resetConfirm && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">新建实验？</h2><p>将替换当前浏览器中的实验。需要保留时，请先保存项目文件。</p><div className="modal-actions"><button className="btn" onClick={() => setResetConfirm(false)}>取消</button><button className="btn" onClick={saveProject}>先保存项目</button><button className="btn btn-primary" onClick={() => { setProject(createDefaultProject()); setTargetId('target1'); setTab('groups'); setResetConfirm(false); notify('已创建默认实验') }}>新建</button></div></div></div>}
  </div>
}
