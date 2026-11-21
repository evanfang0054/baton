import type {
  AcceptanceReport,
  Edge as ProtocolEdge,
  Node as ProtocolNode,
  ReviewView,
  TaskAcceptanceSummary,
  TaskBudgetSummary,
  TaskDetailResponse,
  TaskSummary,
} from '@baton/protocol'
import type { Page } from '@playwright/test'

export interface MockState {
  nodes: ProtocolNode[]
  edges: ProtocolEdge[]
  tasks: TaskSummary[]
  taskDetail: TaskDetailResponse
  acceptance: ReturnType<typeof acceptanceBundle> | null
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

export function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 't1',
    workspaceId: 'w1',
    nodeId: 'a1',
    title: '任务',
    prompt: '<task>演示</task>',
    status: 'review',
    waitingReason: null,
    engine: 'fake',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: 'pnpm test',
    dangerouslySkipPermissions: false,
    budgetUsd: null,
    enqueuedAt: null,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 2,
    attention: 'needs_review',
    waitingSince: Date.now() - 40 * 60_000,
    acceptance: null,
    budget: null,
    ...overrides,
  }
}

export function textNode(
  id: string,
  x: number,
  y: number,
  overrides: Partial<ProtocolNode> = {},
): ProtocolNode {
  return {
    id,
    canvasId: 'c1',
    type: 'text',
    x,
    y,
    w: 240,
    h: 120,
    groupId: null,
    data: { content: '需求 A' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as ProtocolNode
}

export function agentNode(
  id: string,
  x: number,
  y: number,
  overrides: Partial<ProtocolNode> = {},
): ProtocolNode {
  return {
    id,
    canvasId: 'c1',
    type: 'agent',
    x,
    y,
    w: 280,
    h: 160,
    groupId: null,
    data: { title: 'Agent 1', engine: 'fake', taskId: null },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as ProtocolNode
}

export function imageNode(id: string, src: string, x: number, y: number): ProtocolNode {
  return {
    id,
    canvasId: 'c1',
    type: 'image',
    x,
    y,
    w: 240,
    h: 180,
    groupId: null,
    data: { src, alt: '图片' },
    createdAt: 1,
    updatedAt: 1,
  }
}

export function groupNode(
  id: string,
  x: number,
  y: number,
  w = 400,
  h = 300,
  overrides: Partial<ProtocolNode> = {},
): ProtocolNode {
  return {
    id,
    canvasId: 'c1',
    type: 'group',
    x,
    y,
    w,
    h,
    groupId: null,
    data: { label: '需求区', collapsed: false },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as ProtocolNode
}

export function reviewView(overrides: Partial<ReviewView> = {}): ReviewView {
  return {
    id: 'r1',
    taskId: 't1',
    verdict: null,
    verifyExitCode: 0,
    verifyOutput: 'ok',
    diffStat: { filesChanged: 2, insertions: 8, deletions: 1 },
    decidedAt: null,
    preliminaryVerdict: 'pass',
    preliminaryReason: 'VERDICT: PASS',
    preliminaryAt: 3,
    diffAvailable: true,
    ...overrides,
  }
}

export function acceptanceSummary(
  overrides: Partial<TaskAcceptanceSummary> = {},
): TaskAcceptanceSummary {
  return {
    contractId: 'ac1',
    version: 1,
    revision: 0,
    status: 'draft',
    counts: { total: 3, pass: 2, fail: 1, pending: 0, waived: 0 },
    verdict: 'fail',
    topFailures: [{ text: '深链参数未校验', evidence: 'test/login.test.ts' }],
    ...overrides,
  }
}

export function budgetSummary(overrides: Partial<TaskBudgetSummary> = {}): TaskBudgetSummary {
  return {
    budgetUsd: 2,
    spentUsd: 1.2,
    remainingUsd: 0.8,
    ratio: 0.6,
    overBudget: false,
    nearBudget: false,
    workerCostUsd: 1.2,
    verifierCostUsd: 0.1,
    turns: 3,
    ...overrides,
  }
}

export function acceptanceReport(
  acceptance: TaskAcceptanceSummary,
  budget: TaskBudgetSummary,
): AcceptanceReport {
  return {
    taskId: 't1',
    contractId: acceptance.contractId,
    contractVersion: acceptance.version,
    contractRevision: acceptance.revision,
    goal: '登录页修复',
    result: '完成登录与错误提示',
    changes: {
      filesChanged: 2,
      insertions: 8,
      deletions: 1,
      files: ['src/login.tsx', 'test/login.test.ts'],
    },
    verify: { command: 'pnpm test', exitCode: 0, outputSummary: 'ok', skipped: false },
    acceptance: {
      items: [
        {
          id: 'i1',
          contractId: acceptance.contractId,
          ordinal: 1,
          text: '登录成功',
          status: 'pass',
          evidence: 'src/login.tsx:1',
          source: 'verifier',
          updatedAt: 1,
        },
        {
          id: 'i2',
          contractId: acceptance.contractId,
          ordinal: 2,
          text: '错误提示',
          status: 'fail',
          evidence: 'test/login.test.ts',
          source: 'verifier',
          updatedAt: 1,
        },
        {
          id: 'i3',
          contractId: acceptance.contractId,
          ordinal: 3,
          text: '记住我',
          status: 'pass',
          evidence: 'src/login.tsx:8',
          source: 'verifier',
          updatedAt: 1,
        },
      ],
      counts: acceptance.counts,
      verdict: acceptance.verdict,
    },
    usage: {
      workerCostUsd: budget.workerCostUsd,
      verifierCostUsd: budget.verifierCostUsd,
      turns: budget.turns,
      budgetUsd: budget.budgetUsd,
      spentUsd: budget.spentUsd,
      remainingUsd: budget.remainingUsd,
      overBudget: budget.overBudget,
      nearBudget: budget.nearBudget,
    },
    risks: ['1 条验收未通过'],
    unverified: ['错误提示'],
    preliminary: { verdict: 'fail', summary: '1 条未过' },
    hash: 'a'.repeat(64),
  }
}

export function acceptanceBundle(
  options: { acceptance?: TaskAcceptanceSummary; budget?: TaskBudgetSummary } = {},
) {
  const acceptance = options.acceptance ?? acceptanceSummary()
  const budget = options.budget ?? budgetSummary()
  return {
    contract: {
      id: 'ac1',
      taskId: 't1',
      version: 1,
      status: 'draft' as const,
      createdBy: 'verifier' as const,
      revision: 0,
      truncated: false,
      createdAt: 1,
      frozenAt: null,
    },
    items: [
      {
        id: 'i1',
        contractId: 'ac1',
        ordinal: 1,
        text: '登录成功',
        status: 'pass' as const,
        evidence: 'src/login.tsx:1',
        source: 'verifier' as const,
        updatedAt: 1,
      },
      {
        id: 'i2',
        contractId: 'ac1',
        ordinal: 2,
        text: '错误提示',
        status: 'fail' as const,
        evidence: 'test/login.test.ts',
        source: 'verifier' as const,
        updatedAt: 1,
      },
    ],
    run: null,
    report: acceptanceReport(acceptance, budget),
    budget,
  }
}

export function sceneDetail(): TaskDetailResponse {
  return {
    task: {
      ...task(),
      context: {
        included: [
          { id: 'n1', type: 'text', title: '需求 A', depth: 0, chars: 6 },
          { id: 'i1', type: 'image', title: '图片', depth: 0, chars: 0 },
        ],
        dropped: [],
        truncated: false,
        redactedPaths: [],
        relations: [],
        relationsTruncated: false,
        injections: [],
      },
      origin: null,
    },
    contextInvalid: false,
    originInvalid: false,
    sessions: [],
    approvals: [],
    review: reviewView(),
    waitingSince: Date.now() - 40 * 60_000,
    attention: 'needs_review',
    acceptance: acceptanceSummary(),
    budget: budgetSummary(),
  }
}

/**
 * 固定 API 数据；WS 由各 spec 自己接管，便于断言命令和按命令改状态。
 */
export async function mockWorkspace(
  page: Page,
  input: {
    nodes?: ProtocolNode[]
    edges?: ProtocolEdge[]
    tasks?: TaskSummary[]
    taskDetail?: TaskDetailResponse
    reviewDetail?: Partial<ReviewView>
    acceptance?: ReturnType<typeof acceptanceBundle> | null
  } = {},
): Promise<MockState> {
  const state: MockState = {
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    tasks: input.tasks ?? [],
    taskDetail: input.taskDetail ?? sceneDetail(),
    acceptance: input.acceptance ?? null,
  }
  if (input.reviewDetail && state.taskDetail.review) {
    state.taskDetail = {
      ...state.taskDetail,
      review: { ...state.taskDetail.review, ...input.reviewDetail },
    }
  }

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    switch (path) {
      case '/api/workspaces':
        return route.fulfill({
          json: {
            workspaces: [
              {
                id: 'w1',
                name: 'demo',
                relPath: 'demo',
                trusted: true,
                projectHooks: 'off',
                trustedAt: 1,
                createdAt: 1,
              },
            ],
          },
        })
      case '/api/canvas':
        return route.fulfill({
          json: {
            canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
            nodes: state.nodes,
            edges: state.edges,
          },
        })
      case '/api/tasks':
        return route.fulfill({ json: { tasks: state.tasks } })
      case '/api/tasks/t1':
        return route.fulfill({ json: state.taskDetail })
      case '/api/tasks/t1/automation':
        return route.fulfill({
          json: {
            taskId: 't1',
            retryCount: 0,
            lastVerifyExitCode: 0,
            lastPolicyVersion: null,
            autoDecisions: [],
          },
        })
      case '/api/tasks/t1/acceptance':
        return state.acceptance
          ? route.fulfill({ json: state.acceptance })
          : route.fulfill({
              status: 404,
              json: { code: 'acceptance_not_found', message: 'acceptance not found' },
            })
      case '/api/engines':
        return route.fulfill({ json: { engines: [{ engine: 'fake', status: 'available' }] } })
      case '/api/supervisor/status':
        return route.fulfill({
          json: { configured: false, mode: 'explicit', policyVersion: 'p1' },
        })
      case '/api/supervisor/messages':
        return route.fulfill({ json: { threadId: 'th1', messages: [] } })
      case '/api/notices':
        return route.fulfill({ json: { notices: [] } })
      default:
        if (path.startsWith('/api/workspaces/w1/uploads/')) {
          return route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: PNG_1X1,
          })
        }
        return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
    }
  })

  return state
}
