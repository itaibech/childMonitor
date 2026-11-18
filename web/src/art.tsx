import type { CSSProperties } from 'react'
import { fmtDuration } from './usage.ts'

/** House roof sheltering a laptop: the app mark. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 15 16 5l12 10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="9" y="15" width="14" height="9" rx="2" fill="var(--leaf)" />
      <path d="M7 26h18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

function Laptop({ x, y, screen, scale = 1 }: { x: number; y: number; screen: string; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="0" y="0" width="64" height="42" rx="6" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
      <rect x="7" y="7" width="50" height="28" rx="3" fill={screen} />
      <path d="M-8 46h80l-6 8H-2z" fill="var(--ink)" />
    </g>
  )
}

/** Two laptops at home under one roof, with a heart: sign-in and empty states. */
export function HomeArt() {
  return (
    <svg className="art" viewBox="0 0 240 150" aria-hidden="true">
      <circle cx="120" cy="88" r="62" fill="var(--sky)" />
      <path d="M38 78 120 20l82 58" fill="none" stroke="var(--ink)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <Laptop x={52} y={84} screen="var(--kid-a)" />
      <Laptop x={124} y={84} screen="var(--kid-b)" />
      <path d="M120 66c-6-9-20-4-14 6l14 12 14-12c6-10-8-15-14-6z" fill="var(--rose)" className="art-heart" />
    </svg>
  )
}

/** A laptop receiving the client: Download page. */
export function DownloadArt() {
  return (
    <svg className="art" viewBox="0 0 240 150" aria-hidden="true">
      <circle cx="120" cy="84" r="62" fill="var(--sky)" />
      <Laptop x={72} y={70} screen="var(--harbor)" scale={1.5} />
      <path d="M120 22v44m-14-14 14 14 14-14" fill="none" stroke="var(--leaf)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" className="art-arrow" />
      <path d="M120 95l-11 5v8c0 7 5 12 11 14 6-2 11-7 11-14v-8z" fill="var(--surface)" />
    </svg>
  )
}

/**
 * The day as a clock face: one spoke per hour from midnight at the top, as long as the minutes used in that hour,
 * in the child's color. Total screen time in the middle.
 */
export function DayClock({ minutes, totalMs, color, size = 132 }: { minutes: number[]; totalMs: number; color: string; size?: number }) {
  const n = minutes.length || 24
  const label = `${fmtDuration(totalMs)} of screen time`
  return (
    <figure className="day-clock" style={{ '--kid': color, inlineSize: size } as CSSProperties}>
      <svg viewBox="-60 -60 120 120" role="img" aria-label={label}>
        <circle r="31" fill="none" stroke="var(--line-soft)" strokeWidth="1.5" />
        {minutes.map((m, i) => {
          const a = (i / n) * 2 * Math.PI
          const len = 4 + Math.min(m, 60) / 60 * 22
          const [sx, sy] = [Math.sin(a) * 34, -Math.cos(a) * 34]
          const [ex, ey] = [Math.sin(a) * (34 + len), -Math.cos(a) * (34 + len)]
          return <line key={i} className={m > 0 ? 'spoke on' : 'spoke'} style={{ '--i': i } as CSSProperties} x1={sx} y1={sy} x2={ex} y2={ey} />
        })}
      </svg>
      <figcaption aria-hidden="true">{fmtDuration(totalMs)}</figcaption>
    </figure>
  )
}

/**
 * Column chart (hours of a day, days of a week, or a mini 7-day chart). Values share one scale; an optional dashed
 * line marks the average. Each column has a tooltip and the whole chart a spoken summary.
 */
export function Columns(p: { values: number[]; labels: string[]; titles: string[]; label: string; max?: number; avg?: number; mini?: boolean }) {
  const max = p.max ?? Math.max(1, ...p.values, p.avg ?? 0)
  return (
    <div className={p.mini ? 'cols mini' : 'cols'} role="img" aria-label={p.label}>
      <div className="plot">
        {p.avg !== undefined && p.avg > 0 && <div className="avg" style={{ '--a': p.avg / max } as CSSProperties} />}
        {p.values.map((v, i) => (
          <div key={i} className="bar" title={p.titles[i]} style={{ '--h': Math.min(v, max) / max, '--i': i } as CSSProperties} />
        ))}
      </div>
      {!p.mini && <div className="col-labels" aria-hidden="true">{p.labels.map((l, i) => <span key={i}>{l}</span>)}</div>}
    </div>
  )
}

/** Days × hours grid; darker cells mean more minutes used in that hour. */
export function Heatmap({ rows, days }: { rows: number[][]; days: string[] }) {
  return (
    <div className="heat" role="img" aria-label="Minutes used in each hour of each day">
      {rows.map((hours, d) => (
        <div key={d} className="heat-row">
          <span className="heat-day">{days[d]}</span>
          {hours.map((min, h) => (
            <span key={h} className="cell" style={{ '--v': Math.min(min, 60) / 60 } as CSSProperties}
              title={`${days[d]} ${String(h).padStart(2, '0')}:00 · ${Math.round(min)} min`} />
          ))}
        </div>
      ))}
      <div className="heat-row heat-axis" aria-hidden="true">
        <span className="heat-day" />
        {Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
      </div>
    </div>
  )
}

/** Ring split into categories, with a legend that carries the numbers for screen readers. */
export function Donut({ parts, total }: { parts: Array<{ key: string; ms: number }>; total: number }) {
  const C = 2 * Math.PI * 40
  let offset = 0
  return (
    <div className="donut">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="40" className="donut-track" />
        {parts.map((p) => {
          const len = total > 0 ? (p.ms / total) * C : 0
          const seg = <circle key={p.key} cx="50" cy="50" r="40" className={`seg cat-${p.key}`} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />
          offset += len
          return seg
        })}
      </svg>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.key}><span className={`dot cat-${p.key}`} />{p.key}<span className="time">{fmtDuration(p.ms)} · {Math.round((p.ms / total) * 100)}%</span></li>
        ))}
      </ul>
    </div>
  )
}

/** Placeholder shapes while a page loads, so the layout doesn't jump. */
export function Skeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="sk sk-banner" /><div className="sk sk-panel" /><div className="sk sk-panel" />
    </div>
  )
}
