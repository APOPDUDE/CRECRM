export interface TrendPoint {
  label: string
  value: number | null
  n?: number
}

/**
 * Dependency-free responsive SVG line chart. Plots one series over evenly-spaced
 * periods, skipping nulls (gaps in the line) so a sparse history still reads cleanly.
 */
export function TrendChart({
  points,
  format,
  color = '#2563eb',
  title,
}: {
  points: TrendPoint[]
  format: (v: number) => string
  color?: string
  title?: string
}) {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null)
  const W = 600
  const H = 170
  const m = { top: 14, right: 10, bottom: 22, left: 48 }
  const pw = W - m.left - m.right
  const ph = H - m.top - m.bottom

  if (vals.length === 0) {
    return (
      <div className="space-y-1">
        {title && <div className="text-xs font-medium text-muted-foreground">{title}</div>}
        <div className="flex h-[110px] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          No comp data yet for this window
        </div>
      </div>
    )
  }

  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = (max - min) * 0.15 || Math.abs(max) * 0.1 || 1
  const lo = min - pad
  const hi = max + pad
  const n = points.length
  const x = (i: number) => m.left + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw)
  const y = (v: number) => m.top + (1 - (v - lo) / (hi - lo || 1)) * ph

  // Build the line as segments so null gaps break it.
  const segments: string[] = []
  let cur: string[] = []
  points.forEach((p, i) => {
    if (p.value == null) {
      if (cur.length) segments.push(cur.join(' '))
      cur = []
    } else {
      cur.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    }
  })
  if (cur.length) segments.push(cur.join(' '))

  const yTicks = [hi - pad / 2, (hi + lo) / 2, lo + pad / 2]
  // Show ~6 x labels at most.
  const step = Math.max(1, Math.ceil(n / 6))

  return (
    <div className="space-y-1">
      {title && <div className="text-xs font-medium text-muted-foreground">{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeWidth={1} />
            <text x={m.left - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
              {format(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % step === 0 || i === n - 1 ? (
            <text
              key={i}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground"
              fontSize={11}
            >
              {p.label}
            </text>
          ) : null,
        )}
        {segments.map((pts, i) => (
          <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {points.map((p, i) =>
          p.value == null ? null : (
            <circle key={i} cx={x(i)} cy={y(p.value)} r={3} fill={color}>
              <title>
                {p.label}: {format(p.value)}
                {p.n ? ` (n=${p.n})` : ''}
              </title>
            </circle>
          ),
        )}
      </svg>
    </div>
  )
}
