import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from '../src/renderer/components/Sidebar.js'
import type { AppState } from '../src/shared/state.js'
import { INITIAL_STATE } from '../src/shared/state.js'

const mkState = (over: Partial<AppState> = {}): AppState => ({
  ...INITIAL_STATE,
  phase: 'READY',
  audio: { ...INITIAL_STATE.audio, micEnabled: true },
  masks: [{ id: 'a', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
  ptt: { available: true, enabled: false, active: false, error: null, mode: null, keyName: 'F18', keyCode: 188, modifier: null },
  ...over,
})

const mkAxi = () => ({ setMicEnabled: vi.fn(), setMasksVisible: vi.fn(), setPttEnabled: vi.fn() })

describe('Sidebar quick toggles', () => {
  it('mic toggle flips the mic', () => {
    const axi = mkAxi()
    render(<Sidebar active="stream" state={mkState()} onNav={() => {}} axi={axi as never} />)
    fireEvent.click(screen.getByLabelText('Quick toggle microphone'))
    expect(axi.setMicEnabled).toHaveBeenCalledWith(false)
  })

  it('masks toggle disabled without masks, flips visibility with masks', () => {
    const axi = mkAxi()
    const { rerender } = render(<Sidebar active="stream" state={mkState({ masks: [] })} onNav={() => {}} axi={axi as never} />)
    expect(screen.getByLabelText('Quick toggle masks')).toBeDisabled()
    rerender(<Sidebar active="stream" state={mkState()} onNav={() => {}} axi={axi as never} />)
    fireEvent.click(screen.getByLabelText('Quick toggle masks'))
    expect(axi.setMasksVisible).toHaveBeenCalledWith(false)
    rerender(<Sidebar active="stream" state={mkState({ masksVisible: false })} onNav={() => {}} axi={axi as never} />)
    fireEvent.click(screen.getByLabelText('Quick toggle masks'))
    expect(axi.setMasksVisible).toHaveBeenCalledWith(true)
  })

  it('PTT button glows while transmitting', () => {
    render(<Sidebar active="stream" state={mkState({ ptt: { available: true, enabled: true, active: true, error: null, mode: null, keyName: 'F18', keyCode: 188, modifier: null } })} onNav={() => {}} axi={mkAxi() as never} />)
    expect(screen.getByLabelText('Quick toggle push to talk').className).toContain('tx')
  })

  it('PTT toggle hidden when the portal is unavailable, disabled without mic, arms with mic', () => {
    const axi = mkAxi()
    const { rerender } = render(<Sidebar active="stream" state={mkState({ ptt: { available: false, enabled: false, active: false, error: null, mode: null, keyName: 'F18', keyCode: 188, modifier: null } })} onNav={() => {}} axi={axi as never} />)
    expect(screen.queryByLabelText('Quick toggle push to talk')).not.toBeInTheDocument()
    rerender(<Sidebar active="stream" state={mkState({ audio: { ...INITIAL_STATE.audio, micEnabled: false } })} onNav={() => {}} axi={axi as never} />)
    expect(screen.getByLabelText('Quick toggle push to talk')).toBeDisabled()
    rerender(<Sidebar active="stream" state={mkState()} onNav={() => {}} axi={axi as never} />)
    fireEvent.click(screen.getByLabelText('Quick toggle push to talk'))
    expect(axi.setPttEnabled).toHaveBeenCalledWith(true)
  })
})
