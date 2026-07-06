import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MaskEditor } from '../src/renderer/components/MaskEditor.js'
import type { MaskRect } from '../src/shared/state.js'

const m = (id: string): MaskRect => ({ id, x: 0.1, y: 0.1, w: 0.2, h: 0.2 })

describe('MaskEditor', () => {
  it('renders a rect per mask', () => {
    render(<MaskEditor masks={[m('a'), m('b')]} onCommit={() => {}} onDone={() => {}} />)
    expect(screen.getAllByTestId('mask-rect')).toHaveLength(2)
  })

  it('Add mask appends and commits', () => {
    const onCommit = vi.fn()
    render(<MaskEditor masks={[]} onCommit={onCommit} onDone={() => {}} />)
    fireEvent.click(screen.getByText('Add mask'))
    expect(onCommit).toHaveBeenCalledTimes(1)
    const committed = onCommit.mock.calls[0][0] as MaskRect[]
    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject({ x: 0.375, y: 0.4, w: 0.25, h: 0.2 })
    expect(screen.getAllByTestId('mask-rect')).toHaveLength(1)
  })

  it('delete removes the mask and commits', () => {
    const onCommit = vi.fn()
    render(<MaskEditor masks={[m('a')]} onCommit={onCommit} onDone={() => {}} />)
    fireEvent.click(screen.getByLabelText('Delete mask'))
    expect(onCommit).toHaveBeenCalledWith([])
    expect(screen.queryAllByTestId('mask-rect')).toHaveLength(0)
  })

  it('Add is disabled at MAX_MASKS', () => {
    const masks = Array.from({ length: 8 }, (_, i) => m(`m${i}`))
    render(<MaskEditor masks={masks} onCommit={() => {}} onDone={() => {}} />)
    expect(screen.getByText('Add mask').closest('button')).toBeDisabled()
  })

  it('Done calls onDone', () => {
    const onDone = vi.fn()
    render(<MaskEditor masks={[]} onCommit={() => {}} onDone={onDone} />)
    fireEvent.click(screen.getByText('Done'))
    expect(onDone).toHaveBeenCalled()
  })
})
