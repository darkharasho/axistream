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

describe('MaskEditor pointer interactions', () => {
  const layout = () => {
    const wStub = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const hStub = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 450 })
    ;(Element.prototype as any).setPointerCapture = vi.fn()
    ;(Element.prototype as any).releasePointerCapture = vi.fn()
    // jsdom has no PointerEvent — back it with MouseEvent so clientX/Y flow.
    const hadPointerEvent = 'PointerEvent' in window
    ;(window as any).PointerEvent = class extends MouseEvent {
      pointerId: number
      constructor(type: string, init: any = {}) { super(type, init); this.pointerId = init.pointerId ?? 0 }
    }
    return () => {
      if (!hadPointerEvent) delete (window as any).PointerEvent
      if (wStub) Object.defineProperty(HTMLElement.prototype, 'clientWidth', wStub)
      if (hStub) Object.defineProperty(HTMLElement.prototype, 'clientHeight', hStub)
      delete (Element.prototype as any).setPointerCapture
      delete (Element.prototype as any).releasePointerCapture
    }
  }

  it('dragging the rect moves it without resizing', () => {
    const restore = layout()
    try {
      const onCommit = vi.fn()
      const { container } = render(<MaskEditor masks={[m('a')]} onCommit={onCommit} onDone={() => {}} />)
      const editor = container.querySelector('.mask-editor')!
      const rect = screen.getByTestId('mask-rect')
      fireEvent.pointerDown(rect, { pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(editor, { pointerId: 1, clientX: 180, clientY: 100 })
      fireEvent.pointerUp(editor, { pointerId: 1 })
      expect(onCommit).toHaveBeenCalledTimes(1)
      const committed = onCommit.mock.calls[0][0][0]
      expect(committed.x).toBeCloseTo(0.2, 5)
      expect(committed.y).toBeCloseTo(0.1, 5)
      expect(committed.w).toBeCloseTo(0.2, 5)
      expect(committed.h).toBeCloseTo(0.2, 5)
    } finally { restore() }
  })

  it('dragging the corner handle resizes without moving (resize is not hijacked by move)', () => {
    const restore = layout()
    try {
      const onCommit = vi.fn()
      const { container } = render(<MaskEditor masks={[m('a')]} onCommit={onCommit} onDone={() => {}} />)
      const editor = container.querySelector('.mask-editor')!
      const handle = container.querySelector('.mask-resize')!
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(editor, { pointerId: 1, clientX: 180, clientY: 145 })
      fireEvent.pointerUp(editor, { pointerId: 1 })
      expect(onCommit).toHaveBeenCalledTimes(1)
      const committed = onCommit.mock.calls[0][0][0]
      expect(committed.x).toBeCloseTo(0.1, 5)
      expect(committed.y).toBeCloseTo(0.1, 5)
      expect(committed.w).toBeCloseTo(0.3, 5)
      expect(committed.h).toBeCloseTo(0.3, 5)
    } finally { restore() }
  })
})
