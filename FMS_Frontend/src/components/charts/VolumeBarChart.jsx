import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from 'recharts';
import { useChartTheme, cursorStyle, fmtAvg } from './chartTheme.js';
import ChartTooltip from './ChartTooltip.jsx';
import ChartFrame from './ChartFrame.jsx';
import { EmptyState } from '../Card.jsx';

/** Truncate long class names on the axis; the tooltip and table keep the full text. */
const short = (s, n = 14) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Feedback volume per class.
 *
 * Form: count magnitude across a handful of categories → vertical BAR, counts
 * labelled directly above each bar so the axis is a reference rather than
 * something you have to read values off.
 *
 * Sorted by volume descending: with nominal categories there is no inherent
 * order, so ordering by the value being compared is what makes the ranking
 * readable at a glance.
 */
export default function VolumeBarChart({ data }) {
  const t = useChartTheme();

  if (!data?.length) {
    return (
      <EmptyState
        title="No feedback volume yet"
        hint="Bars show how many responses each class has received."
        icon="building"
      />
    );
  }

  const rows = [...data]
    .sort((a, b) => b.responses - a.responses)
    .map((d) => ({ name: d.className, responses: d.responses, average: d.average }));

  const crowded = rows.length > 4;

  return (
    <ChartFrame
      caption="Number of feedback responses per class"
      columns={[
        { key: 'name', label: 'Class' },
        { key: 'responses', label: 'Responses', numeric: true },
        { key: 'avg', label: 'Average', numeric: true },
      ]}
      rows={rows.map((r) => ({ name: r.name, responses: r.responses, avg: fmtAvg(r.average) }))}
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} margin={{ top: 18, right: 8, bottom: 4, left: -16 }} barCategoryGap={20}>
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis
            dataKey="name"
            tickFormatter={(v) => short(v, crowded ? 10 : 16)}
            tick={{ fill: t.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={crowded ? -20 : 0}
            textAnchor={crowded ? 'end' : 'middle'}
            height={crowded ? 52 : 24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: t.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={cursorStyle(t, 'bar')}
            content={
              <ChartTooltip
                rows={(p) => [
                  { label: 'Responses', value: p.responses, color: t.mark },
                  { label: 'Average', value: `${fmtAvg(p.average)} / 5` },
                ]}
              />
            }
          />
          {/* isAnimationActive={false} — polled dashboard; see ParamBarChart. */}
          <Bar dataKey="responses" radius={[4, 4, 0, 0]} maxBarSize={52} isAnimationActive={false}>
            {rows.map((_, i) => (
              <Cell key={i} fill={t.mark} />
            ))}
            <LabelList dataKey="responses" position="top" fill={t.ink} fontSize={11} fontWeight={600} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
