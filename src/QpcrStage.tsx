import { useEffect, useRef, useState, type ReactNode } from 'react'
import { WorkbenchHeader, useWorkbenchTheme } from './WorkbenchHeader'
import './qpcr-host.css'

export function QpcrStage({ active, navigation, onLogout }: { active: boolean; navigation: ReactNode; onLogout: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const hostRef = useRef<HTMLElement>(null)
  const [loaded, setLoaded] = useState(false)
  const { theme } = useWorkbenchTheme()
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      if (event.data?.type === 'qpcr-session-expired') onLogout()
      if (event.data?.type === 'qpcr-ready') frameRef.current?.contentWindow?.postMessage({ type: 'workbench-theme', theme }, window.location.origin)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onLogout, theme])
  useEffect(() => {
    if (loaded) frameRef.current?.contentWindow?.postMessage({ type: 'workbench-theme', theme }, window.location.origin)
  }, [loaded, theme])
  useEffect(() => {
    if (!active || !loaded) return
    const frame = frameRef.current!
    const child = frame.contentWindow!
    const doc = frame.contentDocument!
    const root = doc.getElementById('root')!
    const nav = hostRef.current!.querySelector('nav')!
    let pending = 0

    // Natural root height can shrink; document.scrollHeight includes iframe height.
    const syncLayout = () => {
      pending = 0
      const height = Math.ceil(root.getBoundingClientRect().height)
      if (height > 0 && frame.style.height !== `${height}px`) frame.style.height = `${height}px`
      const rect = frame.getBoundingClientRect()
      const top = Math.max(0, rect.top, nav.getBoundingClientRect().bottom)
      const bottom = Math.min(window.innerHeight, rect.bottom)
      doc.documentElement.style.setProperty('--host-view-top', `${Math.max(0, top - rect.top)}px`)
      doc.documentElement.style.setProperty('--host-view-height', `${Math.max(0, bottom - top)}px`)
      doc.documentElement.style.setProperty('--host-view-bottom', `${Math.max(0, bottom - rect.top)}px`)
    }
    const schedule = () => { if (!pending) pending = requestAnimationFrame(syncLayout) }
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.getBoundingClientRect || target.closest('.modal-backdrop')) return
      requestAnimationFrame(() => {
        const top = frame.getBoundingClientRect().top + target.getBoundingClientRect().top
        const minimum = nav.getBoundingClientRect().bottom + 12
        if (top < minimum) window.scrollBy(0, top - minimum)
      })
    }
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(root)
    resizeObserver.observe(nav)
    const header = hostRef.current!.querySelector('header')
    if (header) resizeObserver.observe(header)
    const themeObserver = new MutationObserver(schedule)
    themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    doc.addEventListener('focusin', onFocus)
    child.dispatchEvent(new Event('resize'))
    syncLayout()
    return () => {
      cancelAnimationFrame(pending)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      doc.removeEventListener('focusin', onFocus)
    }
  }, [active, loaded])

  return <section ref={hostRef} className="qpcr-host" data-theme={theme}>
    <WorkbenchHeader subtitle="qPCR 分组模拟、孔板曲线与模拟原始数据导出" onLogout={onLogout}><div id="qpcr-toolbar-slot" /></WorkbenchHeader>
    {navigation}
    {!loaded && <p className="qpcr-loading" role="status">正在加载 qPCR 工具…</p>}
    <iframe ref={frameRef} className="qpcr-tool-frame" title="qPCR 数据模拟工具" src={`${import.meta.env.BASE_URL}qpcr/index.html`} allow="clipboard-write" onLoad={() => setLoaded(true)} />
  </section>
}
