import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DownloadArt } from './art.tsx'
import * as data from './data.ts'
import type { ClientFile } from './data.ts'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Copies a command; the bubble next to it is the visible and announced feedback. */
export function CopyButton({ text, what }: { text: string; what: string }) {
  const [state, setState] = useState<'' | 'Copied' | 'Copy failed'>('')
  const timer = useRef<number | undefined>(undefined)
  const copy = async () => {
    window.clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setState('Copied')
    } catch {
      setState('Copy failed')
    }
    timer.current = window.setTimeout(() => setState(''), 2000)
  }
  return (
    <span className="copy">
      <button type="button" className="copy-button" aria-label={`Copy ${what}`} data-state={state || undefined} onClick={() => void copy()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {state === 'Copied'
            ? <path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.8" />}
        </svg>
      </button>
      <span className="tip" role="status">{state}</span>
    </span>
  )
}

export function Command({ text, what }: { text: string; what: string }) {
  return (
    <div className="command">
      <code>{text}</code>
      <CopyButton text={text} what={what} />
    </div>
  )
}

function DownloadButton({ file }: { file: ClientFile | null }) {
  const [error, setError] = useState('')
  if (!file) return <p className="note">No client uploaded yet. Upload <b>{data.CLIENT_FILE}</b> below.</p>
  const go = () => data.clientDownloadUrl().then((url) => { location.href = url }, (e: unknown) => setError(message(e)))
  const updated = new Date(file.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <>
      <button className="btn btn-big" onClick={() => void go()}>Download for Windows</button>
      <p className="muted">{data.CLIENT_FILE}, {Math.round(file.size / 1048576)} MB, updated {updated}</p>
      {error && <p role="alert">{error}</p>}
    </>
  )
}

function Upload({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const file = new FormData(e.currentTarget).get('zip')
    if (!(file instanceof Blob) || file.size === 0) return
    setBusy(true)
    setStatus('Uploading…')
    try {
      await data.uploadClient(file)
      setStatus('Uploaded. Laptops can download the new version now.')
      onDone()
    } catch (err) {
      setStatus(`Upload failed: ${message(err)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="panel">
      <summary>Upload a new version</summary>
      <p className="muted">Build it on the Mac with <code>installer/package.sh</code>, then choose <code>installer/dist/{data.CLIENT_FILE}</code>.</p>
      <form className="upload" onSubmit={(e) => void submit(e)}>
        <label htmlFor="zip">Client zip</label>
        <input id="zip" name="zip" type="file" accept=".zip,application/zip" required />
        <button className="btn" type="submit" disabled={busy}>Upload</button>
      </form>
      <p role="status">{status}</p>
    </details>
  )
}

const FOLDER = 'cd "$env:USERPROFILE\\Downloads\\ChildMonitor"'
const UNBLOCK = 'Get-ChildItem -Recurse | Unblock-File'
const INSTALL = 'powershell -ExecutionPolicy Bypass -File .\\install.ps1 -Token <install code>'
const UNINSTALL = 'powershell -ExecutionPolicy Bypass -File .\\uninstall.ps1'

function Steps() {
  return (
    <ol className="steps">
      <li><h3>Make the children's accounts standard</h3>
        <p>On the laptop, open Settings, Accounts, Other users. For each child, choose Change account type and pick Standard user. A child with admin rights can switch the monitor off.</p></li>
      <li><h3>Get an install code</h3>
        <p>Here, in <a href="#/settings">Settings</a>, add the laptop. Copy the install code it shows; it appears only once.</p></li>
      <li><h3>Download and unzip</h3>
        <p>Sign in to the laptop with an administrator account, download the client, then right-click the zip and choose Extract All. Keep the suggested folder, <code>Downloads\ChildMonitor</code>.</p></li>
      <li><h3>Open PowerShell as administrator</h3>
        <p>Open Start, type PowerShell, right-click Windows PowerShell and choose Run as administrator. Then run these, one at a time:</p>
        <Command text={FOLDER} what="folder command" />
        <Command text={UNBLOCK} what="unblock command" />
        <Command text={INSTALL} what="install command" />
        <p className="muted">Replace <code>&lt;install code&gt;</code> with the code from step 2.</p></li>
      <li><h3>Check it works</h3>
        <p>The last lines show <code>ChildMonitorSvc</code> as Running. Within two minutes the laptop's Windows accounts appear in Settings, where you choose who is supervised.</p></li>
    </ol>
  )
}

export function Download() {
  const [file, setFile] = useState<ClientFile | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    data.fetchClientFile().then((f) => { if (live) setFile(f) }, (e: unknown) => { if (live) setError(message(e)) })
    return () => { live = false }
  }, [tick])
  return (
    <div className="page download">
      <section className="hero">
        <DownloadArt />
        <div>
          <h1>Install Child Monitor on a laptop</h1>
          <p className="lede">One install covers every Windows account on the laptop. It runs quietly in the background and the children can't close it.</p>
          {error ? <p role="alert">Could not check the download: {error}</p> : file !== undefined && <DownloadButton file={file} />}
        </div>
      </section>
      <h2>How to install</h2>
      <Steps />
      <section className="panel">
        <h2>Remove it later</h2>
        <p>In the same folder, in an administrator PowerShell:</p>
        <Command text={UNINSTALL} what="uninstall command" />
      </section>
      <Upload onDone={() => setTick((t) => t + 1)} />
    </div>
  )
}
