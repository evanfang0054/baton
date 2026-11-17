export function truncateOutput(input: string, maxBytes: number): string {
  const buffer = Buffer.from(input, 'utf8')
  const max = Math.max(0, maxBytes)
  if (buffer.length <= max) return input
  const half = Math.floor(max / 2)
  const head = buffer.subarray(0, half).toString('utf8')
  const tail = buffer.subarray(buffer.length - half).toString('utf8')
  return `${head}\n…[truncated ${buffer.length - max} bytes]…\n${tail}`
}
