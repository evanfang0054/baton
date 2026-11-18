import {
  AutomationSummary,
  type AutomationPolicyPatch,
  type KillSwitchResponse,
  type Policy,
} from '@baton/protocol'
import type { Config } from '../config.js'
import { getWorkspace, insertAudit, setSetting } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { appError } from '../errors.js'
import { loadPolicy, writePolicy } from '../workspace/policy.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'
import type { AutomationState } from './state.js'
import { hashPolicy } from './version.js'

export interface AutomationServiceDeps {
  db: Db
  config: Config
  state: AutomationState
  now: () => number
  newId: () => string
}

export interface AutomationService {
  getSummary(workspaceId: string): AutomationSummary
  patchPolicy(workspaceId: string, patch: AutomationPolicyPatch): AutomationSummary
  setKillSwitch(enabled: boolean): KillSwitchResponse
}

export function createAutomationService(deps: AutomationServiceDeps): AutomationService {
  function workspacePath(workspaceId: string): string {
    const workspace = getWorkspace(deps.db, workspaceId)
    if (!workspace) {
      throw appError('workspace_not_found', 'workspace not found', { workspaceId })
    }
    return resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
  }

  function getSummary(workspaceId: string): AutomationSummary {
    const workspace = getWorkspace(deps.db, workspaceId)
    if (!workspace) {
      throw appError('workspace_not_found', 'workspace not found', { workspaceId })
    }
    const policy = loadPolicy(workspacePath(workspaceId))
    return AutomationSummary.parse({
      workspaceId,
      trusted: workspace.trusted,
      policy,
      policyVersion: hashPolicy(policy),
      killSwitch: deps.state.isKillSwitchOn(),
      killSwitchForced: deps.state.isForced(),
      digestCronUnsupported: false,
    })
  }

  function patchPolicy(workspaceId: string, patch: AutomationPolicyPatch): AutomationSummary {
    const workspace = getWorkspace(deps.db, workspaceId)
    if (!workspace) {
      throw appError('workspace_not_found', 'workspace not found', { workspaceId })
    }
    if (!workspace.trusted) {
      throw appError('workspace_untrusted', 'workspace is not trusted', { workspaceId })
    }

    const path = workspacePath(workspaceId)
    const current = loadPolicy(path)
    const next: Policy = {
      ...current,
      autopilot: { ...current.autopilot, ...patch.autopilot },
      approval: { ...current.approval, ...patch.approval },
    }
    const { policyVersion } = writePolicy(path, next)
    deps.db.transaction((tx) =>
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'user',
        action: 'automation.policy.update',
        detail: { workspaceId, patch, policyVersion },
      }),
    )
    return getSummary(workspaceId)
  }

  function setKillSwitch(enabled: boolean): KillSwitchResponse {
    if (deps.state.isForced() && !enabled) {
      throw appError('kill_switch_forced', 'kill switch is forced by environment')
    }
    deps.state.setKillSwitch(enabled)
    deps.db.transaction((tx) => {
      setSetting(tx, 'kill_switch', { enabled }, deps.now())
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'user',
        action: 'automation.kill_switch',
        detail: { enabled },
      })
    })
    return {
      killSwitch: deps.state.isKillSwitchOn(),
      killSwitchForced: deps.state.isForced(),
    }
  }

  return { getSummary, patchPolicy, setKillSwitch }
}
