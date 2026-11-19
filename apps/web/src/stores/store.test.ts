import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './app'

const reset = () =>
  useAppStore.setState({
    activeWorkspaceId: 'w1',
    selectedNodeId: null,
    selectedNodeIds: [],
    contextNodeIds: [],
  })

describe('app store selection', () => {
  beforeEach(reset)

  it('keeps only content nodes as context', () => {
    useAppStore.getState().setSelection([
      { id: 't1', type: 'text' },
      { id: 'a1', type: 'agent' },
      { id: 'f1', type: 'file' },
    ])
    expect(useAppStore.getState().selectedNodeIds).toEqual(['t1', 'a1', 'f1'])
    expect(useAppStore.getState().contextNodeIds).toEqual(['t1', 'f1'])
  })

  it('preserves sticky context when the selection is agent-only or empty', () => {
    useAppStore.getState().setSelection([{ id: 't1', type: 'text' }])
    useAppStore.getState().setSelection([{ id: 'a1', type: 'agent' }])
    expect(useAppStore.getState().contextNodeIds).toEqual(['t1'])
    useAppStore.getState().setSelection([])
    expect(useAppStore.getState().contextNodeIds).toEqual(['t1'])
  })

  it('removes one context node and clears all', () => {
    useAppStore.getState().setSelection([
      { id: 't1', type: 'text' },
      { id: 't2', type: 'text' },
    ])
    useAppStore.getState().removeContextNode('t1')
    expect(useAppStore.getState().contextNodeIds).toEqual(['t2'])
    useAppStore.getState().clearContext()
    expect(useAppStore.getState().contextNodeIds).toEqual([])
  })
})

describe('mobile tab', () => {
  beforeEach(() => useAppStore.setState({ mobileTab: 'board' }))

  it('switches tabs', () => {
    useAppStore.getState().setMobileTab('digest')
    expect(useAppStore.getState().mobileTab).toBe('digest')
  })

  it('resets to board when workspace changes', () => {
    useAppStore.getState().setMobileTab('supervisor')
    useAppStore.getState().setWorkspace('w2')
    expect(useAppStore.getState().mobileTab).toBe('board')
  })
})
