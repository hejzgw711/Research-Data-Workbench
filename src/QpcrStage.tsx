import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import './qpcr-host.css'

export function QpcrStage({ active, navigation, onLogout }: { active: boolean; navigation: ReactNode; onLogout: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      if (event.data?.type === 'qpcr-session-expired') onLogout()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onLogout])
  useEffect(() => {
    if (!active || !loaded) return
    const id = requestAnimationFrame(() => {
      frameRef.current?.contentWindow?.dispatchEvent(new Event('resize'))
    })
    return () => cancelAnimationFrame(id)
  }, [active, loaded])

  return <section className="qpcr-host">
    <header className="qpcr-host-header"><div><span>RESEARCH DATA WORKBENCH</span><h1>生成可分析科研数据工作台</h1><p>qPCR 分组模拟、孔板曲线与模拟原始数据导出</p></div><button type="button" onClick={onLogout}><LogOut size={17} />退出登录</button></header>
    {navigation}
    {!loaded && <p className="qpcr-loading" role="status">正在加载 qPCR 工具…</p>}
    <iframe ref={frameRef} className="qpcr-tool-frame" title="qPCR 数据模拟工具" src={`${import.meta.env.BASE_URL}qpcr/index.html`} allow="clipboard-write" onLoad={() => setLoaded(true)} />
  </section>
}
