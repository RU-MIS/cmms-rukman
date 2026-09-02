'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  ShoppingCart, Wallet, HandCoins, TrendingUp, TrendingDown,
  Boxes, ClipboardList, PackageCheck, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { CalendarWidget } from '@/components/ui/CalendarWidget';
import { TopPerformerCard } from '@/components/ui/TopPerformerCard';
import { formatCurrency } from '@/lib/utils';

const PIE_COLORS = ['#227794', '#3f92ac', '#71b3cb', '#a3cfdf', '#c9862f', '#2f9e6e'];

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/dashboard')).data.data,
  });

  const cards = data?.cards;
  const trend = (data?.trend ?? []).map((t: any) => ({
    date: t.date.slice(5),
    Sales: Number(t.sales),
    Purchase: Number(t.purchase),
    Collection: Number(t.collection),
    Profit: Number(t.profit),
  }));
  const stockDistribution = (data?.stockDistribution ?? []).map((c: any) => ({ ...c, value: Number(c.value) }));
  const topProducts = (data?.topProducts ?? []).map((p: any) => ({ ...p, amount: Number(p.amount) }));
  const topCustomers = (data?.topCustomers ?? []).map((c: any) => ({ ...c, amount: Number(c.amount) }));

  return (
    <div>
      <PageHeader title="Dashboard" description="Live overview of your business, generated from real transactions." />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <StatCard label="Today's Sales" value={formatCurrency(cards?.todaySales)} icon={ShoppingCart} tone="brand" />
        <StatCard label="Today's Purchase" value={formatCurrency(cards?.todayPurchase)} icon={PackageCheck} tone="info" />
        <StatCard label="Today's Collection" value={formatCurrency(cards?.todayCollection)} icon={HandCoins} tone="success" />
        <StatCard label="Today's Payment" value={formatCurrency(cards?.todayPayment)} icon={Wallet} tone="warning" />
        <StatCard label="Total Stock Value" value={formatCurrency(cards?.totalStockValue)} icon={Boxes} tone="brand" />
        <StatCard label="Total Receivable" value={formatCurrency(cards?.totalReceivable)} icon={TrendingUp} tone="success" />
        <StatCard label="Total Payable" value={formatCurrency(cards?.totalPayable)} icon={TrendingDown} tone="danger" />
        <StatCard label="Pending Sales Orders" value={String(cards?.pendingSalesOrders ?? 0)} icon={ClipboardList} tone="info" />
        <StatCard label="Pending Purchase Orders" value={String(cards?.pendingPurchaseOrders ?? 0)} icon={ClipboardList} tone="info" />
        <StatCard label="Low Stock Items" value={String(cards?.lowStockCount ?? 0)} icon={AlertTriangle} tone="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className="card p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink mb-3">Sales, Purchase &amp; Collection Trend (14 days)</h2>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#227794" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#227794" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5eef4" vertical={false} />
              <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} stroke="#8fa3b3" />
              <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#8fa3b3" width={40} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #dfe8ef' }}
                formatter={(v: number) => formatCurrency(v)}
              />
              <Area type="monotone" dataKey="Sales" stroke="#227794" fill="url(#salesGrad)" strokeWidth={2} />
              <Area type="monotone" dataKey="Purchase" stroke="#c9862f" fill="none" strokeWidth={1.5} />
              <Area type="monotone" dataKey="Collection" stroke="#2f9e6e" fill="none" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <h2 className="text-sm font-semibold text-ink mb-3">Stock Value by Category</h2>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={stockDistribution} dataKey="value" nameKey="category" innerRadius={45} outerRadius={80} paddingAngle={2}>
                {stockDistribution.map((_: any, i: number) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TopPerformerCard title="Top Products (by sales value)" rows={topProducts.map((p: any) => ({ name: p.product, amount: p.amount }))} />
        <TopPerformerCard title="Top Customers (by sales value)" rows={topCustomers.map((c: any) => ({ name: c.customer, amount: c.amount }))} />
        <CalendarWidget />
      </div>

      {isLoading && <p className="text-sm text-ink-muted mt-4">Loading dashboard…</p>}
    </div>
  );
}
