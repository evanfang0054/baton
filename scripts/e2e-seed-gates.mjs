#!/usr/bin/env node
/**
 * 本地/CI 人闸门验收场景：
 * 1. 在 BATON_WORKSPACES_ROOT 下创建临时 workspace 与 package.json；
 * 2. 通过 REST 创建 workspace；
 * 3. 通过 WS 创建 agent 节点、创建任务并开工；
 * 4. 等 fake agent 进入 waiting_input(approval)；
 * 5. 再创建一个 todo 任务用于验证「立即开工」。
 *
 * 只用于 e2e，不进入 web runtime。依赖 Node 22 全局 fetch 与 WebSocket。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const base = process.env.BATON_BASE_URL ?? 'http://127.0.0.1:7317'
const webBase = process.env.BATON_WEB_URL ?? 'http://127.0.0.1:5173'
const workspacesRoot = process.env.BATON_WORKSPACES_ROOT
if (!workspacesRoot) {
  throw new Error('BATON_WORKSPACES_ROOT is required')
}

const relPath = `demo-${Date.now().toString(36)}`
const workspaceDir = join(workspacesRoot, relPath)
mkdirSync(workspaceDir, { recursive: true })
writeFileSync(
  join(workspaceDir, 'package.json'),
  JSON.stringify(
    {
      name: 'baton-demo',
      private: true,
      scripts: { verify: 'node -e "console.log(\'verify ok\')"' },
    },
    null,
    2,
  ),
)

async function createWorkspace() {
  const response = await fetch(`${base}/api/workspaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: relPath, relPath }),
  })
  if (!response.ok) {
    throw new Error(`create workspace failed: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

function connectWs() {
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`)
  const pending = new Map()
  const waiters = []

  const onMessage = (event) => {
    let message
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (message.type === 'ack') {
      const entry = pending.get(message.payload.commandId)
      if (entry) {
        pending.delete(message.payload.commandId)
        entry.resolve(message.payload.data)
      }
      return
    }
    if (message.type === 'error') {
      const entry = pending.get(message.payload.commandId)
      if (entry) {
        pending.delete(message.payload.commandId)
        entry.reject(new Error(`${message.payload.code}: ${message.payload.message}`))
      }
      return
    }
    for (const waiter of [...waiters]) {
      if (waiter.match(message)) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(message)
      }
    }
  }

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', onMessage)

  const send = (type, payload) =>
    new Promise((resolve, reject) => {
      const id = randomUUID()
      pending.set(id, { resolve, reject })
      socket.send(
        JSON.stringify({
          v: 1,
          id,
          type,
          ts: Date.now(),
          payload,
        }),
      )
    })

  const waitFor = (match, timeoutMs = 15_000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error('timed out waiting for task status'))
      }, timeoutMs)
      const waiter = {
        match,
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
      }
      waiters.push(waiter)
    })

  return { socket, opened, send, waitFor }
}

async function main() {
  const { workspace, canvas } = await createWorkspace()
  const ws = connectWs()
  await ws.opened

  const node = await ws.send('node.create', {
    canvasId: canvas.id,
    node: {
      type: 'agent',
      x: 120,
      y: 120,
      w: 320,
      h: 200,
      groupId: null,
      data: { title: '演示 Agent', engine: 'fake', taskId: null },
    },
  })
  const task = await ws.send('task.create', {
    workspaceId: workspace.id,
    nodeId: node.nodeId,
    title: '演示：审批与验收',
    prompt: '请演示审批与验收',
    contextNodeIds: [],
    engine: 'fake',
    workspaceMode: 'main',
    verifyCommand: 'node -e "console.log(\'verify ok\')"',
  })

  const waiting = ws.waitFor(
    (message) =>
      message.type === 'task.status' &&
      message.payload.taskId === task.taskId &&
      message.payload.status === 'waiting_input',
  )
  await ws.send('task.enqueue', { taskId: task.taskId })
  await waiting

  const todoNode = await ws.send('node.create', {
    canvasId: canvas.id,
    node: {
      type: 'agent',
      x: 120,
      y: 380,
      w: 320,
      h: 200,
      groupId: null,
      data: { title: '待开工 Agent', engine: 'fake', taskId: null },
    },
  })
  const todoTask = await ws.send('task.create', {
    workspaceId: workspace.id,
    nodeId: todoNode.nodeId,
    title: '演示：立即开工',
    prompt: '请演示立即开工',
    contextNodeIds: [],
    engine: 'fake',
    workspaceMode: 'main',
    verifyCommand: 'node -e "console.log(\'verify ok\')"',
  })

  ws.socket.close()
  console.log(
    JSON.stringify(
      {
        workspaceId: workspace.id,
        taskId: task.taskId,
        todoTaskId: todoTask.taskId,
        url: `${webBase}/?workspace=${workspace.id}&task=${task.taskId}`,
        todoUrl: `${webBase}/?workspace=${workspace.id}&task=${todoTask.taskId}`,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
