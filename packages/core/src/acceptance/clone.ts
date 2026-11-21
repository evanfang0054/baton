export interface ClonedAcceptanceItem {
  ordinal: number
  text: string
  status: 'pending'
  evidence: null
  source: 'verifier'
}

export function cloneAcceptanceItems(
  items: ReadonlyArray<{ text: string }>,
): ClonedAcceptanceItem[] {
  return items.map((item, index) => ({
    ordinal: index + 1,
    text: item.text,
    status: 'pending',
    evidence: null,
    source: 'verifier',
  }))
}
