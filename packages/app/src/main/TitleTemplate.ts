export interface TemplateContext {
  now: Date
  counter: number
  dateFormat: string
  gw2?: { character: string; class: string; map: string; race: string; team: string }
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function formatDate(d: Date, fmt: string): string {
  const yyyy = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return fmt
    .replace(/YYYY/g, String(yyyy))
    .replace(/YY/g, pad(yyyy % 100))
    .replace(/MM/g, pad(m))
    .replace(/M/g, String(m))
    .replace(/DD/g, pad(day))
    .replace(/D/g, String(day))
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const fDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDayNum + 3)
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
}

function formatTime(d: Date): string {
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

// Characters people use to fence template variables off from each other.
const SEPARATORS = new Set(['-', '\u2013', '\u2014', '|', '\u00b7', '/'])
const isSeparator = (tok: string) => [...tok].every((c) => SEPARATORS.has(c))

/** Clean up the litter an unresolved variable leaves behind: with GW2 closed,
 *  `{{date}} WvW Raid - {{character}} - {{class}}` renders as
 *  `2026-08-31 WvW Raid -  - `. Operates on the finished string rather than
 *  the template so it needs no per-variable bookkeeping — a separator with
 *  content on both sides (`Willbender - WvW`) is left alone. */
export function tidySeparators(s: string): string {
  const out: string[] = []
  for (const tok of s.split(/\s+/)) {
    if (!tok) continue
    if (isSeparator(tok) && (out.length === 0 || isSeparator(out[out.length - 1]))) continue
    out.push(tok)
  }
  while (out.length && isSeparator(out[out.length - 1])) out.pop()
  return out.join(' ')
}

export function renderTitle(template: string, ctx: TemplateContext): string {
  const vars: Record<string, () => string> = {
    date: () => formatDate(ctx.now, ctx.dateFormat),
    time: () => formatTime(ctx.now),
    day: () => DAYS[ctx.now.getDay()],
    week: () => String(isoWeek(ctx.now)),
    n: () => String(ctx.counter),
    character: () => ctx.gw2?.character ?? '',
    class: () => ctx.gw2?.class ?? '',
    map: () => ctx.gw2?.map ?? '',
    race: () => ctx.gw2?.race ?? '',
    team: () => ctx.gw2?.team ?? '',
  }
  // Only tidy when something actually came back empty — otherwise a title the
  // user spaced deliberately gets rewritten for no reason.
  let dropped = false
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const fn = vars[name]
    const value = fn ? fn() : ''
    if (!value) dropped = true
    return value
  })
  return dropped ? tidySeparators(rendered) : rendered
}
