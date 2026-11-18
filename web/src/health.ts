import type { Device, DeviceEvent } from './types.ts'

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
