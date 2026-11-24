const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const SAFE_STAGE = /^[a-z][a-z0-9-]{0,31}$/
const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/

export function artifactPath(input: {
  deliveryId: string
  stageKey: string
  name: string
}): string | null {
  if (!SAFE_ID.test(input.deliveryId)) return null
  if (!SAFE_STAGE.test(input.stageKey)) return null
  if (!SAFE_NAME.test(input.name) || input.name.includes('..')) return null
  return `.baton/deliveries/${input.deliveryId}/${input.stageKey}/${input.name}`
}
