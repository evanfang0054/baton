export function autoApprovalCapReached(input: { count: number; cap: number }): boolean {
  return input.cap <= 0 || input.count >= input.cap
}
