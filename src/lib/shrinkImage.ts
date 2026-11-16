/**
 * Shrink big photos (phone camera 3–5 MB) before upload: longest side ≤ 1600 px, JPEG ~85 %.
 * Small files, GIFs and PNG logos under the limit are sent unchanged. Never throws — on any
 * problem the original file is uploaded.
 */
const MAX_SIDE = 1600
const SHRINK_ABOVE_BYTES = 1.2 * 1024 * 1024

export async function shrinkImage(file: File): Promise<File> {
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SHRINK_ABOVE_BYTES) return file
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#fff' // flatten any transparency for JPEG
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}
