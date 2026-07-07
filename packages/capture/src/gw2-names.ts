const PROFESSIONS = ['', 'Guardian', 'Warrior', 'Engineer', 'Ranger', 'Thief', 'Elementalist', 'Mesmer', 'Necromancer', 'Revenant']
const RACES = ['', 'Asura', 'Charr', 'Human', 'Norn', 'Sylvari']

export function professionName(id: number): string { return PROFESSIONS[id] ?? '' }
export function raceName(id: number): string { return RACES[id] ?? '' }

const mapCache = new Map<number, string>()
const specCache = new Map<number, string>()

async function lookup(cache: Map<number, string>, url: string, id: number, fetchJson: (url: string) => Promise<any>): Promise<string> {
  const hit = cache.get(id)
  if (hit !== undefined) return hit
  try {
    const data = await fetchJson(url)
    const name = typeof data?.name === 'string' ? data.name : ''
    cache.set(id, name)
    return name
  } catch { return '' } // don't cache failures — allow a later retry
}

export function mapName(id: number, fetchJson: (url: string) => Promise<any>): Promise<string> {
  return lookup(mapCache, `https://api.guildwars2.com/v2/maps/${id}`, id, fetchJson)
}
export function specName(id: number, fetchJson: (url: string) => Promise<any>): Promise<string> {
  return lookup(specCache, `https://api.guildwars2.com/v2/specializations/${id}`, id, fetchJson)
}
