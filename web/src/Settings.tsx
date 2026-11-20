import type { ChangeEvent, CSSProperties, FormEvent } from 'react'
import { Avatar } from './art.tsx'
import { useCallback, useEffect, useState } from 'react'
import * as data from './data.ts'
import { Command } from './Download.tsx'
import { isOutdated, LATEST } from './health.ts'
import type { Child, Device, DeviceUser, Offline } from './types.ts'

function useAsync<T>(fn: () => Promise<T>): { value: T | null; error: string | null; reload: () => void } {
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    fn().then(setValue, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])
  return { value, error, reload: useCallback(() => setTick((t) => t + 1), []) }
}

function ShowToken({ token }: { token: string }) {
  return (
    <div className="token" role="status">
      <p><b>Install code ready.</b> It is shown only once, so copy it now. Follow the steps on the <a href="#/download">Install</a> page and run:</p>
      <Command text={`powershell -ExecutionPolicy Bypass -File .\\install.ps1 -Token ${token}`} what="install command" />
    </div>
  )
}

// ponytail: native switch where supported (Safari); a plain checkbox elsewhere, no polyfill.
const SWITCH: Record<string, string> = { switch: '' }

function Accounts({ deviceId }: { deviceId: string }) {
  const { value, error, reload } = useAsync<DeviceUser[]>(() => data.fetchDeviceUsers(deviceId))
  const toggle = (u: DeviceUser) => data.setSupervised(deviceId, u.sid, !u.supervised).then(reload)
  if (error) return <p role="alert">{error}</p>
  if (!value) return <p>Loading accounts…</p>
  if (value.length === 0) return <p className="muted">No accounts reported yet.</p>
  return (
    <table>
      <thead><tr><th scope="col">Windows account</th><th scope="col">Supervised</th></tr></thead>
      <tbody>
        {value.map((u) => (
          <tr key={u.sid}>
            <th scope="row">{u.win_user} {u.is_admin && <span className="badge">admin</span>}</th>
            <td>
              <label>
                <input type="checkbox" {...SWITCH} aria-label={`Supervised ${u.win_user}`} checked={u.supervised} onChange={() => toggle(u)} /> Supervised
              </label>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Version({ device }: { device: Device }) {
  if (!device.last_seen_at) return null // never reported: nothing to compare yet
  if (!isOutdated(device.agent_version)) return <p className="muted version">Service {device.agent_version}, up to date</p>
  return (
    <p className="update-note">
      Service {device.agent_version ?? 'older than 1.1.0'} is out of date; the latest is {LATEST}. To update, download the zip on the <a href="#/download">Install page</a>, make a new install code here, and run the install again on {device.name}.
    </p>
  )
}

function DeviceRow({ device, childName, onChange }: { device: Device; childName: string; onChange: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = (p: Promise<unknown>) => p.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  const reset = () => run(data.resetDeviceToken(device.id).then(setToken))
  const remove = () => {
    if (confirm(`Revoke and delete ${device.name}?`)) run(data.deleteDevice(device.id).then(onChange))
  }
  return (
    <li className="panel device">
      <div className="device-head">
        <h3>{device.name} <span className="muted">for {childName}</span></h3>
        <div className="actions">
          <button className="btn btn-quiet" onClick={reset}>New install code</button>
          <button className="btn btn-danger" onClick={remove}>Remove laptop</button>
        </div>
      </div>
      <Version device={device} />
      {error && <p role="alert">{error}</p>}
      {token && <ShowToken token={token} />}
      <Accounts deviceId={device.id} />
    </li>
  )
}

function AddLaptop({ children, onAdded }: { children: Child[]; onAdded: () => void }) {
  const [childId, setChildId] = useState('')
  const [name, setName] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const add = () =>
    data.createDevice(childId, name.trim()).then((t) => { setToken(t); setName(''); onAdded() }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  return (
    <section className="panel">
      <h2>Add a laptop</h2>
      <div className="row">
      <label>Child <select value={childId} onChange={(e) => setChildId(e.target.value)}>
        <option value="">Choose…</option>
        {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>{' '}
      <label>Laptop name <input value={name} onChange={(e) => setName(e.target.value)} /></label>{' '}
      <button className="btn" disabled={!childId || !name.trim()} onClick={add}>Add laptop</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {token && <ShowToken token={token} />}
    </section>
  )
}

const AVATAR_PX = 256

/** Center-crops and shrinks a photo to a small square JPEG data URL (about 20 KB). */
async function toAvatar(file: File): Promise<string> {
  const img = await createImageBitmap(file).catch(() => { throw new Error('Could not read that photo. Use a JPEG or PNG.') })
  const side = Math.min(img.width, img.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  canvas.getContext('2d')?.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
  img.close()
  return canvas.toDataURL('image/jpeg', 0.85)
}

function PhotoButtons({ child, run }: { child: Child; run: (p: Promise<unknown>) => void }) {
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) run(toAvatar(file).then((photo) => data.setChildPhoto(child.id, photo)))
  }
  return (
    <>
      <label className="btn btn-quiet file-btn">
        {child.photo ? 'Change photo' : 'Add photo'}
        <input className="sr-only" type="file" accept="image/*" onChange={pick} aria-label={`Photo of ${child.name}`} />
      </label>
      {child.photo
        ? <button className="btn btn-quiet" onClick={() => run(data.setChildPhoto(child.id, null))}>Remove photo</button>
        : <span aria-hidden="true" />}
    </>
  )
}

function ChildrenSection({ children, onChange }: { children: Child[]; onChange: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#e0a03a')
  const [error, setError] = useState<string | null>(null)
  const run = (p: Promise<unknown>) => p.then(onChange, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  const rename = (c: Child) => {
    const next = prompt('New name', c.name)
    if (next?.trim()) run(data.renameChild(c.id, next.trim()))
  }
  const remove = (c: Child) => {
    if (confirm(`Delete ${c.name} and all their data?`)) run(data.deleteChild(c.id))
  }
  return (
    <section className="panel">
      <h2>Children</h2>
      <ul className="kids">
        {children.map((c) => (
          <li key={c.id} style={{ '--kid': c.color ?? 'var(--harbor)' } as CSSProperties}>
            <Avatar child={c} size={44} /><span>{c.name}</span>
            <PhotoButtons child={c} run={run} />
            <button className="btn btn-quiet" onClick={() => rename(c)}>Rename</button>
            <button className="btn btn-danger" onClick={() => remove(c)}>Delete</button>
          </li>
        ))}
      </ul>
      <div className="row">
      <input aria-label="New child name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />{' '}
      <input type="color" aria-label="Color" value={color} onChange={(e) => setColor(e.target.value)} />{' '}
      <button className="btn" disabled={!name.trim()} onClick={() => run(data.addChild(name.trim(), color).then(() => setName('')))}>Add child</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}

const DEFAULT_OFFLINE: Offline = { enabled: false, weekday: { from: '21:30', to: '07:00' }, weekend: { from: '23:00', to: '08:00' } }

function Night({ label, value, onChange }: { label: string; value: Offline['weekday']; onChange: (v: Offline['weekday']) => void }) {
  return (
    <fieldset className="night">
      <legend>{label}</legend>
      <label>From <input type="time" required value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
      <label>Until <input type="time" required value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
    </fieldset>
  )
}

function OfflineForm({ child }: { child: Child }) {
  const [value, setValue] = useState<Offline>(child.offline ?? DEFAULT_OFFLINE)
  const [status, setStatus] = useState('')
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setStatus('Saving…')
    data.setOffline(child.id, value).then(
      () => setStatus(value.enabled ? 'Saved. The laptop picks it up within 5 minutes.' : 'Saved. Offline time is off.'),
      (err: unknown) => setStatus(`Could not save: ${err instanceof Error ? err.message : String(err)}`),
    )
  }
  return (
    <form className="offline" onSubmit={save} style={{ '--kid': child.color ?? 'var(--harbor)' } as CSSProperties}>
      <h3><Avatar child={child} size={32} /> {child.name}</h3>
      <label className="switch-row"><input type="checkbox" {...SWITCH} checked={value.enabled} onChange={(e) => setValue({ ...value, enabled: e.target.checked })} />
        Turn the internet off at night</label>
      <fieldset className="nights" disabled={!value.enabled}>
        <Night label="Sunday to Thursday nights" value={value.weekday} onChange={(weekday) => setValue({ ...value, weekday })} />
        <Night label="Friday and Saturday nights" value={value.weekend} onChange={(weekend) => setValue({ ...value, weekend })} />
      </fieldset>
      <button className="btn" type="submit">Save</button> <span role="status">{status}</span>
    </form>
  )
}

function OfflineSection({ children }: { children: Child[] }) {
  if (children.length === 0) return null
  return (
    <section className="panel">
      <h2>Offline time</h2>
      <p className="muted">While a child is signed in to their laptop during these hours, the internet is off. Your own Windows account isn't affected.</p>
      {children.map((c) => <OfflineForm key={c.id} child={c} />)}
    </section>
  )
}

export function Settings() {
  const kids = useAsync<Child[]>(data.fetchChildren)
  const devs = useAsync<Device[]>(data.fetchDevices)
  const error = kids.error ?? devs.error
  if (error) return <p role="alert">Could not load data: {error}</p>
  if (!kids.value || !devs.value) return <p className="muted">Loading…</p>
  const reload = () => { kids.reload(); devs.reload() }
  const nameOf = (id: string) => kids.value?.find((c) => c.id === id)?.name ?? 'unassigned'
  return (
    <div className="page">
      <h1>Settings</h1>
      <ChildrenSection children={kids.value} onChange={reload} />
      <OfflineSection children={kids.value} />
      <AddLaptop children={kids.value} onAdded={devs.reload} />
      <h2>Laptops</h2>
      {devs.value.length === 0 && <p className="muted">No laptops yet. Add one above, then follow the <a href="#/download">Install</a> steps.</p>}
      <ul className="devices">
        {devs.value.map((d) => <DeviceRow key={d.id} device={d} childName={nameOf(d.child_id)} onChange={devs.reload} />)}
      </ul>
    </div>
  )
}
