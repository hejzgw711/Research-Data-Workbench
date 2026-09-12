import { BarChart3, Dna, FlaskConical, Image as ImageIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { WbApp } from './App'
import SprApp from './spr/App'
import StatApp from './stat/App'
import { QpcrStage } from './QpcrStage'

type Mode = 'wb' | 'spr' | 'stat' | 'qpcr'

function ModeSwitcher({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <nav className="combined-switcher" aria-label="科研工具模式">
      <button type="button" className={mode === 'stat' ? 'active' : ''} aria-pressed={mode === 'stat'} onClick={() => onChange('stat')}>
        <BarChart3 size={16} /> 数据反推生成
      </button>
      <button type="button" className={mode === 'wb' ? 'active' : ''} aria-pressed={mode === 'wb'} onClick={() => onChange('wb')}>
        <ImageIcon size={16} /> WB 灰度测量
      </button>
      <button type="button" className={mode === 'qpcr' ? 'active' : ''} aria-pressed={mode === 'qpcr'} onClick={() => onChange('qpcr')}>
        <Dna size={16} /> qPCR 数据模拟
      </button>
      <button type="button" className={mode === 'spr' ? 'active' : ''} aria-pressed={mode === 'spr'} onClick={() => onChange('spr')}>
        <FlaskConical size={16} /> SPR 数据生成
      </button>
    </nav>
  )
}

export default function CombinedApp({ onLogout }: { onLogout: () => void }) {
  const [mode, setMode] = useState<Mode>(() => window.location.hash === '#qpcr' ? 'qpcr' : 'wb')
  const [visited, setVisited] = useState<Mode[]>([mode])
  const changeMode = (next: Mode) => {
    setVisited((current) => current.includes(next) ? current : [...current, next])
    setMode(next)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next === 'qpcr' ? '#qpcr' : ''}`)
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(frame)
  }, [mode])
  const navigation = <ModeSwitcher mode={mode} onChange={changeMode} />
  return (
    <div className={`combined-shell ${mode}-mode-active`}>
      <div className="mode-content">
        <div className={`wb-stage ${mode === 'wb' ? 'is-visible' : 'is-hidden'}`} aria-hidden={mode !== 'wb'}><WbApp active={mode === 'wb'} onLogout={onLogout} navigation={navigation} /></div>
        {visited.includes('stat') && <div className={`stat-stage ${mode === 'stat' ? 'is-visible' : 'is-hidden'}`} aria-hidden={mode !== 'stat'}><StatApp onLogout={onLogout} navigation={navigation} /></div>}
        {visited.includes('qpcr') && <div className={`qpcr-stage ${mode === 'qpcr' ? 'is-visible' : 'is-hidden'}`} aria-hidden={mode !== 'qpcr'}><QpcrStage active={mode === 'qpcr'} onLogout={onLogout} navigation={navigation} /></div>}
        {visited.includes('spr') && <div className={`spr-stage ${mode === 'spr' ? 'is-visible' : 'is-hidden'}`} aria-hidden={mode !== 'spr'}><SprApp onLogout={onLogout} navigation={navigation} /></div>}
      </div>
    </div>
  )
}
