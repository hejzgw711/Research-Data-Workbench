export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function exportSvgElement(svg: SVGSVGElement, name: string, format: 'svg' | 'png') {
  const exported = svg.cloneNode(true) as SVGSVGElement
  exported.querySelectorAll('[data-export-omit]').forEach(element => element.remove())
  const xml = new XMLSerializer().serializeToString(exported)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  if (format === 'svg') { saveBlob(blob, `${name}.svg`); return }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    const box = svg.viewBox.baseVal
    canvas.width = box.width * 2; canvas.height = box.height * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器无法导出 PNG')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 导出失败')), 'image/png'))
    saveBlob(png, `${name}.png`)
  } finally { URL.revokeObjectURL(url) }
}
