import release from '../../version.json'
import type { Device, DeviceEvent } from './types.ts'

/** The newest laptop service, from version.json at the repo root (the agent build reads the same file). */
export const LATEST = `${release.version} (${release.date})`

const parts = (v: string) => (v.match(/^\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number)

/** True when a laptop reported an older service than LATEST; null/unparsed ("0.1.0", nothing) counts as old. */
export function isOutdated(reported: string | null): boolean {
  const have = parts(reported ?? '')
  const want = parts(release.version)
  for (let i = 0; i < want.length; i++) if ((have[i] ?? 0) !== want[i]) return (have[i] ?? 0) < want[i]
  return false
}

export type DeviceStatus = 'ok' | 'off' | 'silent'

const SILENT_AFTER_MS = 30 * 60_000
const CLEAN_STOPS = new Set(['shutdown', 'suspend', 'logoff', 'lock'])

export function deviceStatus(d: Device, lastEvent: DeviceEvent | undefined, now: Date): DeviceStatus {
  if (!d.last_seen_at) return 'silent'
  if (now.getTime() - Date.parse(d.last_seen_at) <= SILENT_AFTER_MS) return 'ok'
  return lastEvent && CLEAN_STOPS.has(lastEvent.kind) ? 'off' : 'silent'
}

export interface Check {
  label: string
  ok: boolean | null // null: the report doesn't say (older diagnostics command)
  fix: string
}

/** Sections of a diagnostics report, keyed by header text after "== ". */
function sections(body: string): Map<string, string> {
  const out = new Map<string, string>()
  let key = ''
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('== ')) out.set((key = line.slice(3).split(';')[0].trim()), '')
    else if (key) out.set(key, `${out.get(key)}${line}\n`)
  }
  return out
}

const RULES: Array<{ label: string; section: string; pass: RegExp; fix: string }> = [
  { label: 'Service running', section: 'Service', pass: /Status\s*:\s*Running/, fix: 'Run the install command again as administrator.' },
  { label: 'Helper running for a signed-in child', section: 'Helper', pass: /\\/, fix: 'Sign in to Windows as the child, and check the account is supervised in Settings.' },
  { label: 'Install code accepted', section: 'Server check', pass: /"ok"\s*:\s*true/, fix: 'Make a new install code in Settings and run the install command again.' },
  { label: 'Smart App Control off', section: 'Smart App Control', pass: /^\s*0\s*$/, fix: 'Turn it off: see Common questions on the Install page.' },
  { label: `Service up to date (${LATEST})`, section: 'Version', pass: new RegExp(`^\\s*${release.version.replace(/\./g, '\\.')}\\b`, 'm'), fix: 'Download the latest zip on the Install page and run the install on this laptop again.' },
  { label: 'Laptop can reach the server', section: 'Network', pass: /TcpTestSucceeded\s*:\s*True/, fix: 'Check the laptop is online.' },
]

/** Plain-language checklist from a pasted diagnostics report. */
export function summarizeReport(body: string): Check[] {
  const found = sections(body)
  return RULES.map(({ label, section, pass, fix }) => {
    const key = [...found.keys()].find((k) => k.startsWith(section))
    return { label, fix, ok: key === undefined ? null : pass.test(found.get(key) ?? '') }
  })
}
