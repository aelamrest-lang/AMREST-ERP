// Lightweight pure-SVG charts (no external dependency)

export function BarChart({ data, height = 220, color = "#6366f1" }: { data: { label: string; value: number }[]; height?: number; color?: string }) {
  const max = Math.max(1, ...data.map(d => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    <div className="w-full">
      <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 2 - 10);
          return (
            <g key={i}>
              <rect x={i * w + w * 0.15} y={height / 2 - h - 6} width={w * 0.7} height={h} fill={color} rx={0.6}>
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="flex w-full mt-1">
        {data.map((d, i) => (
          <div key={i} className="text-[10px] text-slate-500 dark:text-slate-400 text-center truncate" style={{ width: `${w}%` }}>{d.label}</div>
        ))}
      </div>
    </div>
  );
}

export function LineChart({ data, height = 220, color = "#10b981" }: { data: { label: string; value: number }[]; height?: number; color?: string }) {
  const max = Math.max(1, ...data.map(d => d.value));
  const min = Math.min(0, ...data.map(d => d.value));
  const range = Math.max(1, max - min);
  const points = data.map((d, i) => {
    const x = (i / Math.max(1, data.length - 1)) * 100;
    const y = (height / 2 - 6) - ((d.value - min) / range) * (height / 2 - 12);
    return `${x},${y}`;
  }).join(" ");
  return (
    <div className="w-full">
      <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="0.6" />
        {data.map((d, i) => {
          const x = (i / Math.max(1, data.length - 1)) * 100;
          const y = (height / 2 - 6) - ((d.value - min) / range) * (height / 2 - 12);
          return <circle key={i} cx={x} cy={y} r="0.8" fill={color}><title>{`${d.label}: ${d.value}`}</title></circle>;
        })}
      </svg>
      <div className="flex w-full mt-1">
        {data.map((d, i) => (
          <div key={i} className="text-[10px] text-slate-500 dark:text-slate-400 text-center truncate" style={{ width: `${100 / data.length}%` }}>{d.label}</div>
        ))}
      </div>
    </div>
  );
}

export function DonutChart({ data, size = 180 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let acc = 0;
  const r = size / 2 - 14;
  const cx = size / 2, cy = size / 2;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = 2 * Math.PI * r * frac;
          const gap = 2 * Math.PI * r - dash;
          const rot = (acc / total) * 360 - 90;
          acc += d.value;
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth="14"
              strokeDasharray={`${dash} ${gap}`} transform={`rotate(${rot} ${cx} ${cy})`} strokeLinecap="butt"
            ><title>{`${d.label}: ${d.value}`}</title></circle>
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-slate-700 dark:fill-slate-200" fontSize="14" fontWeight="700">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fill-slate-500" fontSize="9">Total</text>
      </svg>
      <div className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded" style={{ background: d.color }} />
            <span className="text-slate-600 dark:text-slate-300">{d.label}</span>
            <span className="text-slate-500 ml-auto font-medium">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
