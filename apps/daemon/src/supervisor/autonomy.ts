import type { AutonomyMode, Policy } from '@baton/protocol'
import { capabilityAutonomy } from '@baton/core'
import type { Config } from '../config.js'
import { hashPolicy } from '../automation/version.js'
import { getWorkspace } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { loadPolicy } from '../workspace/policy.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'

export interface WorkspacePolicyInfo {
  policy: Policy
  policyVersion: string
  trusted: boolean
  autoRetry: (killSwitch: boolean) => AutonomyMode
  attentionReminder: (killSwitch: boolean) => AutonomyMode
}

export function loadWorkspacePolicy(
  db: Db,
  config: Pick<Config, 'workspacesRoot'>,
  workspaceId: string,
): WorkspacePolicyInfo | null {
  const workspace = getWorkspace(db, workspaceId)
  if (!workspace) return null
  const policy = loadPolicy(resolveWorkspaceDir(config.workspacesRoot, workspace.relPath))
  return {
    policy,
    policyVersion: hashPolicy(policy),
    trusted: workspace.trusted,
    autoRetry: (killSwitch) => capabilityAutonomy(policy, 'autoRetry', { killSwitch }),
    attentionReminder: (killSwitch) =>
      capabilityAutonomy(policy, 'attentionReminder', { killSwitch }),
  }
}
