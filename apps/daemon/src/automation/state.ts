export interface AutomationState {
  isKillSwitchOn(): boolean
  isForced(): boolean
  setKillSwitch(enabled: boolean): void
}

export function createAutomationState(input: {
  initial: boolean
  forced: boolean
}): AutomationState {
  let enabled = input.forced || input.initial
  return {
    isKillSwitchOn: () => enabled,
    isForced: () => input.forced,
    setKillSwitch: (next) => {
      enabled = input.forced || next
    },
  }
}
