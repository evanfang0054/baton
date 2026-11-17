const codeBlockBase = [
  'overflow-auto rounded-lg border border-separator bg-background p-3',
  'font-mono text-xs whitespace-pre-wrap text-foreground',
].join(' ')

export const codeBlockClass = `mt-2 max-h-40 ${codeBlockBase}`
export const verifyOutputClass = `mt-2 max-h-48 ${codeBlockBase}`
export const transcriptCodeClass = [
  'mt-1 overflow-x-auto rounded-lg border border-separator bg-background p-3',
  'font-mono text-xs whitespace-pre-wrap text-foreground',
].join(' ')
