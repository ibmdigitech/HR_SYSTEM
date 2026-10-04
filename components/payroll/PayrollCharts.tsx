"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { TrendingUp, Users, Clock } from "lucide-react";

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const tooltipStyle = { borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' };

const formatAed = (value: number) => `AED ${Math.round(value).toLocaleString()}`;

/** Keeps small values readable — the previous formatter printed "AED 0.5k". */
const formatAedTick = (value: number) => (Math.abs(value) >= 1000 ? `AED ${Math.round(value / 1000)}k` : `AED ${value}`);

/**
 * An empty chart box reads as "broken" and a fabricated series reads as real
 * money. When a series has no rows the card says so instead of drawing an
 * axis with nothing on it.
 */
function ChartEmptyState({ icon: Icon, message }: { icon: typeof TrendingUp; message: string }) {
    return (
        <div className="h-80 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <Icon className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">No data to chart</p>
            <p className="text-xs text-slate-500 max-w-xs">{message}</p>
        </div>
    );
}

/**
 * An area chart needs two points to draw a line. With a single recorded period
 * Recharts renders axes and one lone dot, which reads as a broken chart, so one
 * period is drawn as a bar instead.
 */
function TrendChart({ data }: { data: { label: string; total: number }[] }) {
    const axes = (
        <>
            <XAxis dataKey="label" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatAedTick} />
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatAed(Number(value))} />
        </>
    );

    if (data.length === 1) {
        return (
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    {axes}
                    <Bar dataKey="total" name="Net salary" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={120} />
                </BarChart>
            </ResponsiveContainer>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                </defs>
                {axes}
                <Area type="monotone" dataKey="total" name="Net salary" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorTotal)" />
            </AreaChart>
        </ResponsiveContainer>
    );
}

export function PayrollCharts({
    trendData,
    departmentData,
    overtimeData,
    trendCaption,
    departmentCaption,
    overtimeCaption,
}: {
    trendData: { label: string; total: number }[];
    departmentData: { name: string; cost: number }[];
    overtimeData: { label: string; hours: number }[];
    trendCaption: string;
    departmentCaption: string;
    overtimeCaption: string;
}) {
    return (
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            {/* Monthly Trend Chart */}
            <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 shadow-sm rounded-2xl">
                <CardHeader>
                    <CardTitle className="text-lg font-bold">Monthly Payroll Trend</CardTitle>
                    <CardDescription className="font-medium">{trendCaption}</CardDescription>
                </CardHeader>
                <CardContent className="h-80">
                    {trendData.length === 0 ? (
                        <ChartEmptyState
                            icon={TrendingUp}
                            message="No salary records exist yet, so there is no monthly payroll trend to plot. Run a payroll to create the first period."
                        />
                    ) : (
                        <TrendChart data={trendData} />
                    )}
                </CardContent>
            </Card>

            {/* Department Distribution */}
            <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 shadow-sm rounded-2xl">
                <CardHeader>
                    <CardTitle className="text-lg font-bold">Department Salary Cost</CardTitle>
                    <CardDescription className="font-medium">{departmentCaption}</CardDescription>
                </CardHeader>
                <CardContent className="h-80">
                    {departmentData.length === 0 ? (
                        <ChartEmptyState
                            icon={Users}
                            message="No salary records exist for this period, so there is no department cost to compare."
                        />
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={departmentData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }} layout="vertical">
                                <XAxis type="number" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatAedTick} />
                                <YAxis dataKey="name" type="category" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} width={100} />
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                                <Tooltip cursor={{fill: 'transparent'}} contentStyle={tooltipStyle} formatter={(value) => formatAed(Number(value))} />
                                <Bar dataKey="cost" name="Net salary" fill="#10b981" radius={[0, 4, 4, 0]}>
                                    {departmentData.map((entry, index) => (
                                        <Cell key={`cell-${entry.name}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>

            {/* Overtime Trend */}
            <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 shadow-sm rounded-2xl">
                <CardHeader>
                    <CardTitle className="text-lg font-bold">Overtime Trend</CardTitle>
                    <CardDescription className="font-medium">{overtimeCaption}</CardDescription>
                </CardHeader>
                <CardContent className="h-80">
                    {overtimeData.length === 0 ? (
                        <ChartEmptyState
                            icon={Clock}
                            message="No overtime has been logged in this window, so there is no hours trend to plot. Log overtime from the Overtime page."
                        />
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={overtimeData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorOt" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="label" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} unit=" hrs" />
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <Tooltip contentStyle={tooltipStyle} formatter={(value) => `${Number(value).toLocaleString()} hrs`} />
                                <Area type="monotone" dataKey="hours" name="Overtime hours" stroke="#f59e0b" strokeWidth={3} fillOpacity={1} fill="url(#colorOt)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
