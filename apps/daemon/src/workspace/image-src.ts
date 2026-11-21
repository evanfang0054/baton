import { basename } from 'node:path'

const UPLOAD_PREFIX = '.baton/uploads/'

/**
 * ImageNode.src 只允许两种形态：
 * - 本地上传：`.baton/uploads/<safe-name>`，不能带子路径/穿越
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
      !name.includes('/')
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
