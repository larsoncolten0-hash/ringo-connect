"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type ChartDatum = { label: string; minor: number; partial: boolean };

/** One bar chart for ONE metric. Presentation only: the values are the server's minor-unit figures; the division by 10^digits is only to scale the axis. */
export default function TrendChart({ data, digits, formatMoney, ariaLabel }: { data: ChartDatum[]; digits: number; formatMoney: (minor: number) => string; ariaLabel: string }) {
  const scale = 10 ** digits;
  const rows = data.map((d) => ({ label: d.label, value: d.minor / scale, minor: d.minor, partial: d.partial }));
  const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  return (
    <div className="h-56 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--ringo-border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(v) => compact.format(Number(v))} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(_v, _n, item: any) => [formatMoney(item?.payload?.minor ?? 0), ""]} separator="" />
          <Bar dataKey="value" fill="#4F46E5" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
