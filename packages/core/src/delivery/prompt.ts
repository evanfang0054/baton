import type { ArtifactKind } from '@baton/protocol'
import { buildAnnotationBlock, type AnnotationContext } from '../annotation/block.js'
import { escapeAttr } from '../context/assemble.js'

export interface StagePromptArtifact {
  kind: ArtifactKind
  name: string
  path: string
  required: boolean
}

export interface StagePromptInput {
  delivery: { id: string; title: string; goal: string }
  stage: { key: string; label: string; gate: 'human' | 'auto'; ordinal: number }
  produces: StagePromptArtifact[]
  acceptance: { checklist: string[]; verify: boolean }
  previous: Array<{ stageKey: string; artifacts: StagePromptArtifact[] }>
  skill: { id: string; path: string; summary: string } | null
  annotations: AnnotationContext[]
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function artifactLine(artifact: StagePromptArtifact, indent = '    '): string {
  const required = artifact.required ? ' required="true"' : ''
  return `${indent}<artifact kind="${artifact.kind}" name="${escapeAttr(artifact.name)}" path="${escapeAttr(artifact.path)}"${required}/>`
}

export function buildStagePrompt(input: StagePromptInput): string {
  const lines: string[] = [
    `<delivery id="${escapeAttr(input.delivery.id)}" title="${escapeAttr(input.delivery.title)}">`,
    `  <goal>${escapeText(input.delivery.goal)}</goal>`,
    '</delivery>',
    `<stage key="${escapeAttr(input.stage.key)}" label="${escapeAttr(input.stage.label)}" gate="${input.stage.gate}" ordinal="${input.stage.ordinal}">`,
    '  <produces>',
    ...input.produces.map((artifact) => artifactLine(artifact)),
    '  </produces>',
    `  <acceptance verify="${input.acceptance.verify ? 'true' : 'false'}">`,
    ...input.acceptance.checklist.map((item) => `    <item>${escapeText(item)}</item>`),
    '  </acceptance>',
  ]
  for (const previous of input.previous) {
    lines.push(`  <previous stage="${escapeAttr(previous.stageKey)}">`)
    lines.push(...previous.artifacts.map((artifact) => artifactLine(artifact)))
    lines.push('  </previous>')
  }
  if (input.skill) {
    lines.push(
      `  <skill id="${escapeAttr(input.skill.id)}" path="${escapeAttr(input.skill.path)}" summary="${escapeAttr(input.skill.summary)}"/>`,
    )
  }
  const annotations = buildAnnotationBlock(input.annotations)
  if (annotations) lines.push(annotations)
  lines.push('</stage>')
  return lines.join('\n')
}
