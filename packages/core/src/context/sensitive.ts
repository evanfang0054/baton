const SENSITIVE_SEGMENT = /^(\.env.*|.*\.pem|.*\.key|id_rsa.*|id_ed25519.*|.*secret.*)$/i

/**
 * 只做路径字符串判断，不读文件系统。
 * 调用方在真正读取文件前也必须调用一次，形成纵深防御。
 */
export function isSensitivePath(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => SENSITIVE_SEGMENT.test(segment))
}
