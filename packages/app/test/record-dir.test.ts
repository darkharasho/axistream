import { describe, it, expect } from 'vitest'
import { defaultRecordDir, validateRecordDir, RECORD_DIR_ERROR } from '../src/main/record-dir.js'

const HOME = '/home/u'

describe('defaultRecordDir', () => {
  it('is Videos/AxiStream under the given home', () => {
    expect(defaultRecordDir(HOME)).toBe('/home/u/Videos/AxiStream')
  })
})

describe('validateRecordDir', () => {
  it('accepts a path inside home', () => {
    expect(validateRecordDir('/home/u/Videos/AxiStream', HOME)).toEqual({ ok: true })
  })

  it('accepts home itself', () => {
    expect(validateRecordDir('/home/u', HOME)).toEqual({ ok: true })
  })

  it('rejects a path outside home', () => {
    expect(validateRecordDir('/mnt/games/vods', HOME)).toEqual({ ok: false, error: RECORD_DIR_ERROR })
  })

  it('rejects a sibling directory that merely shares the home prefix', () => {
    expect(validateRecordDir('/home/user2/vods', HOME)).toEqual({ ok: false, error: RECORD_DIR_ERROR })
  })

  it('rejects a traversal that escapes home', () => {
    expect(validateRecordDir('/home/u/../other/vods', HOME)).toEqual({ ok: false, error: RECORD_DIR_ERROR })
  })

  it('rejects an empty path', () => {
    expect(validateRecordDir('', HOME).ok).toBe(false)
  })
})
