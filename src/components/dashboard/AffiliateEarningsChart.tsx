"use client";

import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { formatPrice } from "@/lib/currency";

export default function AffiliateEarningsChart({
  data,
  currency,
}: {
  data: { month: string; amount: number }[];
  currency: string;
}) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="affiliateFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14B8A6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#14B8A6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--ringo-border)" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => new Date(`${v}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            width={56}
            tickFormatter={(v) => formatPrice(v, currency).replace(/\.00$/, "")}
          />
          <Tooltip
            formatter={(value: number) => [formatPrice(value, currency), "Earned"]}
            labelFormatter={(v) => new Date(`${v}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Area type="monotone" dataKey="amount" stroke="#14B8A6" strokeWidth={2} fill="url(#affiliateFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
