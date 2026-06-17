export interface ChartSeries {
  label: string
  color: string
  values: (number | null)[]
}

function segmentsOf(values: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  const segs: string[] = []
  let cur: string[] = []
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) segs.push(cur.join(' '))
      cur = []
    } else {
      cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    }
  })
  if (cur.length) segs.push(cur.join(' '))
  return segs
}

/**
 * Dependency-free responsive multi-series SVG line chart. Nulls break the line so a
 * sparse history still reads cleanly; an isolated point renders as a dot.
 */
export function TrendChart({
  labels,
  series,
  format,
  title,
}: {
  labels: string[]
  series: ChartSeries[]
  format: (v: number) => string
  title?: string
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null)
  const W = 600
  const H = 180
  const m = { top: 14, right: 12, bottom: 24, left: 48 }
  const pw = W - m.left - m.right
  const ph = H - m.top - m.bottom

  const legend = (
    <div className="flex items-center gap-3">
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )

  if (all.length === 0) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          {title && <div className="text-xs font-medium text-muted-foreground">{title}</div>}
          {legend}
        </div>
        <div className="flex h-[120px] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          No comp data yet for this window
        </div>
      </div>
    )
  }

  const min = Math.min(...all)
  const max = Math.max(...all)
  const pad = (max - min) * 0.15 || Math.abs(max) * 0.1 || 1
  const lo = min - pad
  const hi = max + pad
  const n = labels.length
  const x = (i: number) => m.left + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw)
  const y = (v: number) => m.top + (1 - (v - lo) / (hi - lo || 1)) * ph
  const yTicks = [hi - pad / 2, (hi + lo) / 2, lo + pad / 2]
  const step = Math.max(1, Math.ceil(n / 6))

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        {title && <div className="text-xs font-medium text-muted-foreground">{title}</div>}
        {legend}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeWidth={1} />
            <text x={m.left - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((lab, i) =>
          i % step === 0 || i === n - 1 ? (
            <text
              key={i}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground"
              fontSize={11}
            >
              {lab}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <g key={s.label}>
            {segmentsOf(s.values, x, y).map((pts, i) => (
              <polyline key={i} points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {s.values.map((v, i) =>
              v == null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color}>
                  <title>
                    {s.label} {labels[i]}: {format(v)}
                  </title>
                </circle>
              ),
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}
