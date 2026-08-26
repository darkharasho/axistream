// Self-test for the RELEASE_NOTES.md section extractor. Plain node, no test
// framework: this is release tooling outside the workspaces, and CI runs it as
// one cheap step. `node scripts/test-release-notes.mjs`
import assert from 'node:assert/strict'
import { extractNotes } from './release-notes.mjs'

const MD = `# Release Notes

## Version v1.0.1 — August 30, 2026

### Second thing
Body of the newer release.

## Version v1.0.0 — August 25, 2026

### First thing
Body of the older release.

More of it.
`

// The requested section, and only it — a later section must not bleed in.
{
  const out = extractNotes(MD, 'v1.0.0')
  assert.match(out, /First thing/)
  assert.match(out, /More of it/)
  assert.doesNotMatch(out, /Second thing/)
}

// The newest section stops at the next heading, not at end-of-file.
{
  const out = extractNotes(MD, 'v1.0.1')
  assert.match(out, /Second thing/)
  assert.doesNotMatch(out, /First thing/)
}

// A missing section returns empty rather than the whole file — the CLI turns
// that into a hard failure, which is the entire point of the gate.
assert.equal(extractNotes(MD, 'v9.9.9').trim(), '')

// The heading must match exactly; a prefix is not a match.
assert.equal(extractNotes(MD, 'v1.0').trim(), '')

console.log('release-notes extractor: 4 checks passed')
