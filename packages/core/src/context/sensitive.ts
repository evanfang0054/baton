const SENSITIVE_SEGMENT =
  /^(\.env.*|\.npmrc|\.netrc|\.git-credentials|credentials\.json|.*\.(pem|key|p12|pfx|keystore)|id_rsa(?!\.pub$).*|id_ed25519(?!\.pub$).*|.*secret.*)$/i

/**
 * 只做路径字符串判断，不读文件系统。
 * 调用方在真正读取文件前也必须调用一次，形成纵深防御。
 * `*secret*` 有意保守：宁可多脱敏，也不漏掉业务私密文件。
 */
export function isSensitivePath(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => SENSITIVE_SEGMENT.test(segment))
}
