// Charts (Recharts). One series per chart, so a single brand hue is used;
// values are labelled directly and every bar has a hover tooltip.
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { ratioValue, money } from "../lib/format.js";

const BLUE = "#2a78d6";
const BLUE_LIGHT = "#9cc2ee";
const GRID = "#e2e8f0";
const AXIS = "#64748b";

function TooltipBox({ active, payload, format }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-slate-900">{p.label}</p>
      <p className="mt-0.5 tabular text-slate-600">{format(p.value, p)}</p>
      {p.note && <p className="mt-1 max-w-[220px] text-slate-500">{p.note}</p>}
    </div>
  );
}

/**
 * Horizontal bars for the ratios of one category.
 * rows: [{ label, value, unit }]; reference: optional x value (e.g. 1.0) with a label.
 */
export function RatioBars({ rows, reference, height }) {
  const h = height ?? Math.max(120, rows.length * 44 + 30);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 0 }} barCategoryGap={10}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} domain={[0, "auto"]} />
        <YAxis type="category" dataKey="label" width={128} tick={{ fontSize: 12, fill: "#334155" }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "#f1f5f9" }} content={<TooltipBox format={(v, p) => ratioValue(v, p.unit)} />} />
        {reference && (
          <ReferenceLine x={reference.value} stroke="#94a3b8" strokeDasharray="4 3"
            label={{ value: reference.label, position: "top", fontSize: 10, fill: AXIS }} />
        )}
        <Bar dataKey="value" fill={BLUE} radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList dataKey="value" position="right" formatter={(v) => v} content={({ x, y, width, height: hh, index }) => (
            <text x={x + width + 6} y={y + hh / 2} dominantBaseline="middle" fontSize={12} fill="#0f172a" className="tabular">
              {ratioValue(rows[index].value, rows[index].unit)}
            </text>
          )} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical bars in USD millions; negative values drop below the axis. */
export function MoneyBars({ rows, height = 240, highlightLast = false }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 20, right: 8, bottom: 4, left: 8 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} interval={0} />
        <YAxis tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} width={52}
          tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
        <ReferenceLine y={0} stroke="#94a3b8" />
        <Tooltip cursor={{ fill: "#f1f5f9" }} content={<TooltipBox format={(v) => money(v)} />} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
          {rows.map((r, i) => (
            <Cell key={r.label} fill={highlightLast && i === rows.length - 1 ? BLUE : r.muted ? BLUE_LIGHT : BLUE} />
          ))}
          <LabelList dataKey="value" content={({ x, y, width, value, height: hh }) => (
            <text x={x + width / 2} y={value < 0 ? y + hh + 14 : y - 6} textAnchor="middle" fontSize={11} fill="#334155" className="tabular">
              {`${value < 0 ? "−" : ""}${Math.round(Math.abs(value) / 1000)}k`}
            </text>
          )} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
