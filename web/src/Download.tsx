import { useEffect, useRef, useState, type FormEvent } from 'react'
import { DownloadArt } from './art.tsx'
import * as data from './data.ts'
import type { ClientFile, Diagnostic } from './data.ts'
import release from '../../version.json'
import { LATEST, summarizeReport } from './health.ts'

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
  const day = (d: string | number) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const updated = day(file.updatedAt)
  return (
    <>
      <button className="btn btn-big" onClick={() => void go()}>Download for Windows</button>
      <p className="muted">Version {release.version}, released {day(release.date)}</p>
      <p className="muted">{data.CLIENT_FILE}, {Math.round(file.size / 1048576)} MB, uploaded {updated}</p>
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
      <p className="muted">Build it on the Mac with <code>installer/package.sh</code>, then choose <code>installer/dist/{data.CLIENT_FILE}</code>. This site expects service {LATEST}.</p>
      <form className="upload" onSubmit={(e) => void submit(e)}>
        <label htmlFor="zip">Client zip</label>
        <input id="zip" name="zip" type="file" accept=".zip,application/zip" required />
        <button className="btn" type="submit" disabled={busy}>Upload</button>
      </form>
      <p role="status">{status}</p>
    </details>
  )
}

// Gathers service state, files, recent errors and a short foreground run, then copies it all. Never reads config.json.
const DIAGNOSE = String.raw`& {
'== Service'; Get-Service ChildMonitorSvc -ErrorAction SilentlyContinue | Format-List Name,Status,StartType
'== Program files'; Get-ChildItem 'C:\Program Files\ChildMonitor' -ErrorAction SilentlyContinue | Measure-Object | Select-Object Count
'== Data'; Get-ChildItem C:\ProgramData\ChildMonitor -ErrorAction SilentlyContinue | Format-Table Name,Length,LastWriteTime
'== Supervised accounts'; Get-Content C:\ProgramData\ChildMonitor\supervised.json -ErrorAction SilentlyContinue; Get-CimInstance Win32_UserAccount -Filter 'LocalAccount=True' | Format-Table Name,SID,Disabled
'== Signed in'; quser 2>&1
'== Resource use (CPU seconds since start, memory MB)'; Get-Process ChildMonitorService,Helper,WmiPrvSE -ErrorAction SilentlyContinue | Format-Table Name,Id,@{n='CPU s';e={[int]$_.CPU}},@{n='Mem MB';e={[int]($_.WorkingSet64/1MB)}},StartTime
'== Helper'; Get-Process Helper -IncludeUserName -ErrorAction SilentlyContinue | Format-Table Id,SessionId,UserName,StartTime
'== Service manager'; Get-WinEvent -LogName System -MaxEvents 400 | Where-Object { $_.ProviderName -eq 'Service Control Manager' -and $_.Message -like '*Child Monitor*' } | Select-Object -First 10 | Format-List TimeCreated,Message
'== App errors'; Get-WinEvent -LogName Application -MaxEvents 400 | Where-Object { $_.ProviderName -in 'ChildMonitorSvc','.NET Runtime','Application Error' } | Select-Object -First 15 | Format-List TimeCreated,ProviderName,Message
'== Smart App Control (0 off, 1 on, 2 evaluation)'; (Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
'== Offline time'; Get-Content C:\ProgramData\ChildMonitor\offline.json -ErrorAction SilentlyContinue; netsh advfirewall show currentprofile firewallpolicy
'== Version'; (Get-Item 'C:\Program Files\ChildMonitor\Core.dll' -ErrorAction SilentlyContinue).VersionInfo.ProductVersion
'== Build date'; (Get-Item 'C:\Program Files\ChildMonitor\Core.dll' -ErrorAction SilentlyContinue).LastWriteTime
'== Server check (answer only, never the code)'; try { $c = Get-Content C:\ProgramData\ChildMonitor\config.json -Raw | ConvertFrom-Json
  Invoke-RestMethod -Method Post "$($c.supabaseUrl)/rest/v1/rpc/ingest" -Headers @{ apikey = $c.apiKey; Authorization = "Bearer $($c.apiKey)"; 'Content-Profile' = 'childmonitor' } -ContentType 'application/json' -Body (@{ token = $c.token; batch = @{} } | ConvertTo-Json) | ConvertTo-Json -Compress } catch { "failed: $($_.ErrorDetails.Message) $($_.Exception.Message)" }
'== Network'; Test-NetConnection hyeslwlewvvjiyizoduf.supabase.co -Port 443 | Format-List TcpTestSucceeded,RemoteAddress
'== Foreground run'; if ((Get-Service ChildMonitorSvc -ErrorAction SilentlyContinue).Status -ne 'Running') {
  $p = Start-Process 'C:\Program Files\ChildMonitor\ChildMonitorService.exe' -PassThru -WindowStyle Hidden -RedirectStandardError "$env:TEMP\cm-err.txt" -RedirectStandardOutput "$env:TEMP\cm-out.txt"
  Start-Sleep 10; if (-not $p) { 'could not start' } elseif ($p.HasExited) { "exited with code $($p.ExitCode)" } else { Stop-Process $p -Force; 'still running after 10 s' }
  Get-Content "$env:TEMP\cm-err.txt","$env:TEMP\cm-out.txt" -ErrorAction SilentlyContinue } else { 'skipped: service is running' }
} *>&1 | Out-String -Width 200 | Set-Clipboard; 'Copied. Paste it on the Diagnostics page.'`

function Checklist({ body }: { body: string }) {
  const checks = summarizeReport(body)
  const failed = checks.filter((c) => c.ok === false)
  return (
    <>
      <p className={failed.length ? 'verdict bad' : 'verdict good'}>
        {failed.length ? `${failed.length} ${failed.length === 1 ? 'problem' : 'problems'} found` : 'No problems found'}
      </p>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.label} className={c.ok === null ? 'unknown' : c.ok ? 'pass' : 'fail'}>
            <span className="sr-only">{c.ok === null ? 'Not checked:' : c.ok ? 'OK:' : 'Problem:'}</span>
            {c.label}{c.ok === false && <span className="fix">{c.fix}</span>}
          </li>
        ))}
      </ul>
    </>
  )
}

function Report({ r, open }: { r: Diagnostic; open: boolean }) {
  return (
    <details className="panel report" open={open}>
      <summary>Report from {new Date(r.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</summary>
      <Checklist body={r.body} />
      <details className="raw">
        <summary>Full report</summary>
        <div className="raw-actions"><CopyButton text={r.body} what="report" /></div>
        <pre>{r.body}</pre>
      </details>
    </details>
  )
}

function SendForm({ onSent }: { onSent: () => Promise<void> }) {
  const [status, setStatus] = useState('')
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const body = String(new FormData(form).get('report') ?? '').trim()
    if (!body) return
    setStatus('Sending…')
    try {
      await data.sendDiagnostics(body)
      form.reset()
      setStatus('Sent. The checklist is below.')
      await onSent()
    } catch (err) {
      setStatus(`Could not send: ${message(err)}`)
    }
  }
  return (
    <form className="send" onSubmit={(e) => void submit(e)}>
      <label htmlFor="report">Report</label>
      <textarea id="report" name="report" required spellCheck={false} placeholder="Paste the report here" />
      <button className="btn" type="submit">Send report</button>
      <p role="status">{status}</p>
    </form>
  )
}

export function Diagnose() {
  const [reports, setReports] = useState<Diagnostic[] | null>(null)
  const [error, setError] = useState('')
  const load = () => data.fetchDiagnostics().then(setReports, (e: unknown) => setError(message(e)))
  useEffect(() => { void load() }, [])
  return (
    <div className="page diagnose">
      <h1>Diagnostics</h1>
      <p className="lede">Check a laptop that isn't reporting. The report lists what's running and what's wrong; it never includes the install code.</p>
      <ol className="steps">
        <li><h3>Copy the check</h3><Command text={DIAGNOSE} what="diagnostics command" /></li>
        <li><h3>Run it on the laptop</h3><p>Open PowerShell as administrator, paste and press Enter. When it says Copied, the report is on the clipboard.</p></li>
        <li><h3>Paste the report here</h3><SendForm onSent={load} /></li>
      </ol>
      <h2>Reports</h2>
      {error && <p role="alert">Could not load reports: {error}</p>}
      {reports === null && !error && <div className="sk sk-panel" aria-busy="true" aria-label="Loading reports" />}
      {reports?.length === 0 && <p className="muted">No reports yet.</p>}
      {reports?.map((r, i) => <Report key={r.id} r={r} open={i === 0} />)}
    </div>
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
        <p>The last lines show <code>ChildMonitorSvc</code> as Running. Within two minutes the laptop's Windows accounts appear in Settings, where you choose who is supervised. If not, see <a href="#/diagnose">Diagnostics</a>.</p></li>
    </ol>
  )
}

function Faq() {
  return (
    <section className="panel faq">
      <h2>Common questions</h2>
      <details>
        <summary>The install says the service "cannot be started", or Windows shows a security popup</summary>
        <p>Windows 11 Smart App Control is blocking it. It blocks programs that aren't code-signed, and Child Monitor isn't signed yet. It has no way to allow a single program, so it has to be turned off:</p>
        <ol>
          <li>Sign in to the laptop with an administrator account.</li>
          <li>Open Start, type <b>Smart App Control</b> and open it (or Windows Security, App &amp; browser control, Smart App Control settings).</li>
          <li>Choose <b>Off</b> and confirm. Microsoft Defender antivirus keeps protecting the laptop.</li>
          <li>Run the install command from step 4 again.</li>
        </ol>
        <p className="muted">On some Windows versions Smart App Control can't be turned back on without reinstalling Windows. The <a href="#/diagnose">Diagnostics</a> report shows its state: 0 is off, 1 on, 2 evaluation.</p>
      </details>
      <details>
        <summary>The laptop says Reporting, but no apps or sites show up</summary>
        <p>Only supervised accounts are recorded, and administrator accounts aren't supervised unless you turn them on in <a href="#/settings">Settings</a>. Sign in to Windows with the child's own account and use the laptop; activity shows up within a couple of minutes.</p>
      </details>
      <details>
        <summary>The laptop says Not reporting</summary>
        <p>Run the check on the <a href="#/diagnose">Diagnostics</a> page on that laptop and send the report.</p>
      </details>
    </section>
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
      <Faq />
      <section className="panel">
        <h2>Remove it later</h2>
        <p>In the same folder, in an administrator PowerShell:</p>
        <Command text={UNINSTALL} what="uninstall command" />
      </section>
      <Upload onDone={() => setTick((t) => t + 1)} />
    </div>
  )
}
