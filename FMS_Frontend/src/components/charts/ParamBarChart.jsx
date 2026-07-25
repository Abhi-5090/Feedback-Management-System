import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from 'recharts';
import { useChartTheme, cursorStyle, fmtAvg } from './chartTheme.js';
import ChartTooltip from './ChartTooltip.jsx';
import ChartFrame from './ChartFrame.jsx';
import { EmptyState } from '../Card.jsx';

/**
 * Average stars per parameter.
 *
 * Form: magnitude compared across categories → BAR. Horizontal, because the
 * category labels are sentences ("Trainer's subject knowledge") and reading
 * them along the y-axis beats rotating them under an x-axis.
 *
 * Single series → one brand hue, direct value labels at each bar end, no legend
 * (the panel title names the series). Fixed 0–5 domain so a 4.2 always sits in
 * the same place — a domain that rescales to the data makes two panels
 * incomparable and silently exaggerates small differences.
 */
export default function ParamBarChart({ data }) {
  const t = useChartTheme();

  if (!data?.length) {
    return (
      <EmptyState
        title="No ratings yet"
        hint="Averages appear here once students submit feedback for this selection."
        icon="barChart"
      />
    );
  }

  const rows = data.map((d) => ({ name: d.label, value: d.average, responses: d.responses }));
  const height = Math.max(200, rows.length * 44);

  return (
    <ChartFrame
      caption="Average rating out of 5 for each feedback parameter"
      columns={[
        { key: 'name', label: 'Parameter' },
        { key: 'avg', label: 'Average', numeric: true },
        { key: 'responses', label: 'Responses', numeric: true },
      ]}
      rows={rows.map((r) => ({ name: r.name, avg: fmtAvg(r.value), responses: r.responses }))}
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          layout="vertical"
          data={rows}
          margin={{ top: 4, right: 44, bottom: 4, left: 8 }}
          barCategoryGap={12}
        >
          <CartesianGrid horizontal={false} stroke={t.grid} />
          <XAxis
            type="number"
            domain={[0, 5]}
            ticks={[0, 1, 2, 3, 4, 5]}
            tick={{ fill: t.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={160}
            tick={{ fill: t.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={cursorStyle(t, 'bar')}
            content={
              <ChartTooltip
                rows={(p) => [
                  { label: 'Average', value: `${fmtAvg(p.value)} / 5`, color: t.mark },
                  { label: 'Responses', value: p.responses },
                ]}
              />
            }
          />
          {/* 4px rounded data-end, square at the baseline — the bar should read
              as growing FROM the axis, not floating as a lozenge.

              isAnimationActive={false}: this dashboard polls every ~8s, so an
              entrance animation would replay forever — bars re-growing from zero
              every few seconds. Frequent animation is worse than none. It also
              means the DATA never depends on a JS animation loop settling. */}
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
            {rows.map((_, i) => (
              <Cell key={i} fill={t.mark} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={fmtAvg}
              fill={t.ink}
              fontSize={11}
              fontWeight={600}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
