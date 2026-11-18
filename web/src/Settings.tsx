import { useCallback, useEffect, useState } from 'react'
import * as data from './data.ts'
import type { Child, Device, DeviceUser } from './types.ts'

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
      <p>Run on the laptop as administrator:</p>
      <code>{`powershell -ExecutionPolicy Bypass -File install.ps1 -Token ${token}`}</code>
      <p className="muted">This token is shown only once. Copy it now.</p>
    </div>
  )
}

function Accounts({ deviceId }: { deviceId: string }) {
  const { value, error, reload } = useAsync<DeviceUser[]>(() => data.fetchDeviceUsers(deviceId))
  const toggle = (u: DeviceUser) => data.setSupervised(deviceId, u.sid, !u.supervised).then(reload)
  if (error) return <p role="alert">{error}</p>
  if (!value) return <p>Loading accounts…</p>
  if (value.length === 0) return <p className="muted">No accounts reported yet.</p>
  return (
    <table>
      <tbody>
        {value.map((u) => (
          <tr key={u.sid}>
            <td>{u.win_user} {u.is_admin && <span className="badge">admin</span>}</td>
            <td>
              <label>
                <input type="checkbox" aria-label={`Supervised ${u.win_user}`} checked={u.supervised} onChange={() => toggle(u)} /> Supervised
              </label>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <li className="card">
      <h4>{device.name} <span className="muted">({childName})</span></h4>
      <button className="btn" onClick={reset}>Reset token</button>{' '}
      <button className="btn" onClick={remove}>Revoke</button>
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
    <section>
      <h3>Add laptop</h3>
      <label>Child <select value={childId} onChange={(e) => setChildId(e.target.value)}>
        <option value="">Choose…</option>
        {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>{' '}
      <label>Laptop name <input value={name} onChange={(e) => setName(e.target.value)} /></label>{' '}
      <button className="btn" disabled={!childId || !name.trim()} onClick={add}>Add laptop</button>
      {error && <p role="alert">{error}</p>}
      {token && <ShowToken token={token} />}
    </section>
  )
}

function ChildrenSection({ children, onChange }: { children: Child[]; onChange: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#4f46e5')
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
    <section>
      <h3>Children</h3>
      <ul>
        {children.map((c) => (
          <li key={c.id}>{c.name}{' '}
            <button onClick={() => rename(c)}>Rename</button>{' '}
            <button onClick={() => remove(c)}>Delete</button>
          </li>
        ))}
      </ul>
      <input aria-label="New child name" value={name} onChange={(e) => setName(e.target.value)} />{' '}
      <input type="color" aria-label="Color" value={color} onChange={(e) => setColor(e.target.value)} />{' '}
      <button className="btn" disabled={!name.trim()} onClick={() => run(data.addChild(name.trim(), color).then(() => setName('')))}>Add child</button>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}

export function Settings() {
  const kids = useAsync<Child[]>(data.fetchChildren)
  const devs = useAsync<Device[]>(data.fetchDevices)
  const error = kids.error ?? devs.error
  if (error) return <p role="alert">Could not load data: {error}</p>
  if (!kids.value || !devs.value) return <p>Loading…</p>
  const reload = () => { kids.reload(); devs.reload() }
  const nameOf = (id: string | null) => kids.value?.find((c) => c.id === id)?.name ?? 'unassigned'
  return (
    <div>
      <h2>Settings</h2>
      <ChildrenSection children={kids.value} onChange={reload} />
      <AddLaptop children={kids.value} onAdded={devs.reload} />
      <h3>Laptops</h3>
      <ul className="child-list">
        {devs.value.map((d) => <DeviceRow key={d.id} device={d} childName={nameOf(d.child_id)} onChange={devs.reload} />)}
      </ul>
    </div>
  )
}
