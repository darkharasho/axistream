export interface TemplateContext {
  now: Date
  counter: number
  dateFormat: string
  gw2?: { character: string; class: string; map: string; race: string }
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
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const fn = vars[name]
    return fn ? fn() : ''
  })
}
