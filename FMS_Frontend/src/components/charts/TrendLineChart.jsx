import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useChartTheme, cursorStyle, fmtAvg } from './chartTheme.js';
import ChartTooltip from './ChartTooltip.jsx';
import ChartFrame from './ChartFrame.jsx';
import { EmptyState } from '../Card.jsx';

/**
 * Rating trend over time.
 *
 * Form: change over time → LINE, with a soft area fill for weight. The fill is
 * decorative only — the LINE carries the value, so the gradient fades to zero
 * rather than reading as a filled quantity.
 *
 * One y-axis, fixed 0–5. Never a second axis: a dual-scale chart lets the
 * author imply any correlation they like, which is why it's the single most
 * common charting mistake.
 */
export default function TrendLineChart({ data }) {
  const t = useChartTheme();

  if (!data?.length) {
    return (
      <EmptyState
        title="No trend yet"
        hint="A line appears once this selection has feedback spanning more than one day."
        icon="trendUp"
      />
    );
  }

  const rows = data.map((d) => ({
    date: d.date?.slice(5),
    fullDate: d.date,
    average: d.average,
    responses: d.responses,
  }));

  // A single point can't draw a line — show the dot so the day still registers.
  const single = rows.length === 1;

  return (
    <ChartFrame
      caption="Average rating over time"
      columns={[
        { key: 'fullDate', label: 'Date' },
        { key: 'avg', label: 'Average', numeric: true },
        { key: 'responses', label: 'Responses', numeric: true },
      ]}
      rows={rows.map((r) => ({ fullDate: r.fullDate, avg: fmtAvg(r.average), responses: r.responses }))}
    >
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
          <defs>
            <linearGradient id="fmsTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={t.mark} stopOpacity={0.2} />
              <stop offset="100%" stopColor={t.mark} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: t.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            domain={[0, 5]}
            ticks={[0, 1, 2, 3, 4, 5]}
            tick={{ fill: t.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={cursorStyle(t, 'line')}
            content={
              <ChartTooltip
                rows={(p) => [
                  { label: 'Average', value: `${fmtAvg(p.average)} / 5`, color: t.mark },
                  { label: 'Responses', value: p.responses },
                ]}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="average"
            stroke={t.line}
            strokeWidth={2}
            fill="url(#fmsTrendFill)"
            // ≥8px markers so they're actually hittable; hidden on dense series
            // where a dot per day turns the line into a caterpillar.
            dot={single || rows.length <= 12 ? { r: 3.5, fill: t.line, strokeWidth: 2, stroke: t.surface } : false}
            activeDot={{ r: 5, fill: t.line, strokeWidth: 2, stroke: t.surface }}
            // No entrance animation: the dashboard polls every ~8s, so it would
            // replay constantly, and the line must never be invisible while a
            // JS animation settles. See ParamBarChart for the full reasoning.
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
