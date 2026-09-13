import { useLayoutEffect, useRef, useState } from 'react'

export function useChartWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(640)
  // Reconnect if an empty preview is replaced by a chart; hidden tools keep their last width.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => { const next = Math.floor(element.clientWidth); if (next > 0) setWidth(current => current === next ? current : next) }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  })
  return { ref, width }
}
