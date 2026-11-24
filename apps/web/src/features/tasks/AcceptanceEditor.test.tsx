import type { AcceptanceContract, AcceptanceItem } from '@baton/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { AcceptanceEditor } from './AcceptanceEditor'

const contract: AcceptanceContract = {
  id: 'ac1',
  taskId: 't1',
  version: 1,
  status: 'draft',
  createdBy: 'verifier',
  revision: 0,
  truncated: false,
  createdAt: 1,
  frozenAt: null,
}

function item(ordinal: number, text: string): AcceptanceItem {
  return {
    id: `i${ordinal}`,
    contractId: 'ac1',
    ordinal,
    text,
    status: 'pending',
    evidence: null,
    source: 'verifier',
    updatedAt: 1,
  }
}

describe('AcceptanceEditor', () => {
  it('adds and waives items, then submits the full replacement', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const onSaved = vi.fn()
    render(
      <CommandProvider send={send}>
        <AcceptanceEditor
          taskId="t1"
          contract={contract}
          items={[item(1, '登录成功')]}
          onSaved={onSaved}
        />
      </CommandProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '添加条目' }))
    await waitFor(() => expect(screen.getByLabelText('验收条目 2')).toHaveFocus())
    fireEvent.change(screen.getByLabelText('验收条目 2'), { target: { value: '错误提示正确' } })
    fireEvent.click(screen.getByRole('button', { name: '豁免第 1 条' }))
    fireEvent.click(screen.getByRole('button', { name: '保存验收清单' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'acceptance.update',
        payload: {
          taskId: 't1',
          contractId: 'ac1',
          expectedRevision: 0,
          items: [
            { id: 'i1', text: '登录成功', status: 'waived', evidence: null },
            { text: '错误提示正确', status: 'pending', evidence: null },
          ],
        },
      }),
    )
    expect(onSaved).toHaveBeenCalled()
    expect(await screen.findByText('已保存')).toBeInTheDocument()
  })

  it('is read-only after the contract is frozen', () => {
    render(
      <CommandProvider send={vi.fn()}>
        <AcceptanceEditor
          taskId="t1"
          contract={{ ...contract, status: 'frozen' }}
          items={[item(1, '登录成功')]}
          onSaved={vi.fn()}
        />
      </CommandProvider>,
    )
    expect(screen.getByRole('button', { name: '保存验收清单' })).toBeDisabled()
    expect(screen.getByLabelText('验收条目 1')).toBeDisabled()
    expect(screen.getByText('验收清单当前为只读，不能再修改。')).toBeInTheDocument()
  })
})
