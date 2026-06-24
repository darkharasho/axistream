import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TitlePromptModal } from '../src/renderer/components/TitlePromptModal.js'

const axi = { goLive: vi.fn(async () => {}) }
beforeEach(() => { (globalThis as any).axi = axi; vi.clearAllMocks() })

describe('TitlePromptModal', () => {
  it('disables Go Live until a title is entered, then submits it', () => {
    const onClose = vi.fn()
    render(<TitlePromptModal onClose={onClose} />)
    const go = screen.getByRole('button', { name: /go live/i }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My Stream' } })
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    expect(axi.goLive).toHaveBeenCalledWith('My Stream')
    expect(onClose).toHaveBeenCalled()
  })
})
