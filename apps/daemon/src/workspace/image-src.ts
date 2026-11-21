import { basename, extname } from 'node:path'

export const UPLOAD_DIR = '.baton/uploads'
export const UPLOAD_PREFIX = `${UPLOAD_DIR}/`

/** 上传与读取共用同一份扩展名白名单，避免写进去却读不出来。 */
export const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

/**
 * ImageNode.src 只允许两种形态：
 * - 本地上传：`.baton/uploads/<safe-name>`，不能带子路径/穿越，扩展名必须是图片
 * - 外链：https，长度 ≤2048，不带用户名/密码
 * daemon 不抓取外链，这里只做落库前的格式校验。
 */
export function isValidImageSrc(src: string): boolean {
  if (src.startsWith(UPLOAD_PREFIX)) {
    const name = src.slice(UPLOAD_PREFIX.length)
    return (
      name.length > 0 &&
      name === basename(name) &&
      !name.includes('\\') &&
      !name.includes('..') &&
      !name.includes('/') &&
      Object.hasOwn(IMAGE_MIME, extname(name).toLowerCase())
    )
  }
  if (src.length === 0 || src.length > 2048) return false
  if (/^(data|file|javascript):/i.test(src)) return false
  try {
    const url = new URL(src)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}
