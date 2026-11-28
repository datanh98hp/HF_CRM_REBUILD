'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkspaceLayout } from '@/components/workspace-layout';
import { Toast } from '@/components/ui/toast';
import { useCrmSession } from '@/components/crm-session';
import { request } from '@/lib/crm-api';

type ReportType = 'customers' | 'plans' | 'summary' | 'loans';
type ReportPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';
type ReportSection = 'report-customers' | 'report-plans' | 'report-summary' | 'report-loans';
type ReportTable = {
  title: string;
  description?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  footer?: ReportRow;
};
type Metric = {
  key: string;
  label: string;
  value: number | string | null;
  format: 'number' | 'currency' | 'percent';
  detail?: string;
};
type ReportColumn = { key: string; label: string; format?: 'number' | 'currency' | 'percent' | 'staff' | 'status' | 'text' };
type ReportRow = Record<string, string | number | null>;
type ReportPayload = {
  report: ReportType;
  period: { type: ReportPeriod; offset: number; start: string; endExclusive: string };
  metrics: Metric[];
  trendTitle: string;
  trendFormat: 'number' | 'currency';
  trend: { label: string; value: number }[];
  trendSeries?: { id: string; label: string; values: number[] }[];
  statuses: { key: string; label: string; count: number; percentage: number }[];
  table: ReportTable;
  staffTable?: ReportTable;
  filters: {
    access: 'self' | 'branch' | 'all';
    branchId: string | null;
    adviserId: string | null;
    branches: { id: string; name: string }[];
    advisers: { id: string; name: string }[];
  };
};

const periodOptions: { value: ReportPeriod; label: string }[] = [
  { value: 'day', label: 'Ngày' },
  { value: 'week', label: 'Tuần' },
  { value: 'month', label: 'Tháng' },
  { value: 'quarter', label: 'Quý' },
  { value: 'year', label: 'Năm' },
];

const reportDefinitions: Record<ReportType, { title: string; description: string; section: ReportSection }> = {
  customers: {
    title: 'Khách hàng',
    description: 'Khách hàng mới, trạng thái chăm sóc và phân bổ theo chi nhánh.',
    section: 'report-customers',
  },
  plans: {
    title: 'Kế hoạch',
    description: 'Tình hình kế hoạch và trạng thái theo khoảng thời gian.',
    section: 'report-plans',
  },
  summary: {
    title: 'Báo cáo tổng hợp',
    description: 'Tổng quan khách hàng, kế hoạch, hồ sơ vay và giải ngân.',
    section: 'report-summary',
  },
  loans: {
    title: 'Hợp đồng vay & sản phẩm vay',
    description: 'Tỷ lệ giải ngân, kết quả xét duyệt và số liệu theo sản phẩm vay.',
    section: 'report-loans',
  },
};

function localDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function currentChartIndex(period: ReportPeriod, start: string) {
  const now = new Date();
  const current = localDateParts(now);
  const startDate = localDateParts(new Date(start));
  if (period === 'day') {
    const hour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now));
    return Math.floor(hour / 4);
  }
  if (period === 'week') {
    const currentUtc = Date.UTC(current.year, current.month - 1, current.day);
    const startUtc = Date.UTC(startDate.year, startDate.month - 1, startDate.day);
    return Math.max(0, Math.min(6, Math.floor((currentUtc - startUtc) / 86_400_000)));
  }
  if (period === 'month') return Math.min(4, Math.floor((current.day - 1) / 7));
  if (period === 'quarter') return (current.month - startDate.month + 12) % 12;
  return current.month - 1;
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString('vi-VN', { maximumFractionDigits });
}

function formatCompactCurrency(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${formatNumber(value / 1_000_000_000, 2)} tỷ đ`;
  if (absolute >= 1_000_000) return `${formatNumber(value / 1_000_000, 1)} tr đ`;
  return `${formatNumber(value)} đ`;
}

function formatFullCurrency(value: number | string) {
  const amount = Number(value);
  return `${formatNumber(amount, 2)} đ`;
}

function metricValue(metric: Metric) {
  if (metric.value === null) return '—';
  if (metric.format === 'currency') return formatCompactCurrency(Number(metric.value));
  if (metric.format === 'percent') return `${formatNumber(Number(metric.value), 2)}%`;
  return formatNumber(Number(metric.value));
}

function periodRangeLabel(data: ReportPayload) {
  const start = new Date(data.period.start);
  const end = new Date(Date.parse(data.period.endExclusive) - 1);
  const formatDate = (date: Date) => new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
  const startParts = localDateParts(start);
  if (data.period.type === 'day') return formatDate(start);
  if (data.period.type === 'month') {
    return new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(start);
  }
  if (data.period.type === 'quarter') {
    return `Quý ${Math.floor((startParts.month - 1) / 3) + 1}, ${startParts.year}`;
  }
  if (data.period.type === 'year') return String(startParts.year);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function statusBadgeClass(status: string) {
  if (['COMPLETED', 'CONVERTED', 'APPROVED'].includes(status)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100';
  }
  if (['PENDING_REVIEW', 'PENDING_APPROVAL', 'AWAITING_CUSTOMER_CONFIRMATION'].includes(status)) {
    return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100';
  }
  if (['REJECTED', 'CANCELLED'].includes(status)) {
    return 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100';
  }
  return 'border-border bg-muted text-muted-foreground';
}

function ReportChart({ data, isCurrentPeriod }: { data: ReportPayload; isCurrentPeriod: boolean }) {
  const series = data.trendSeries ?? [];
  const maximum = Math.max(
    0,
    ...(series.length
      ? series.flatMap(({ values }) => values)
      : data.trend.map(({ value }) => value)),
  );
  const activeIndex = isCurrentPeriod ? currentChartIndex(data.period.type, data.period.start) : -1;
  const hasData = data.trend.some(({ value }) => value > 0);

  return (
    <Card className="min-w-0 gap-0 border-border bg-card px-4 py-4 shadow-none sm:px-5 sm:py-5">
      <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{data.trendTitle}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.trendFormat === 'currency' ? 'Số tiền · đồng' : 'Số lượng'}
            {isCurrentPeriod ? ' · Kỳ đang diễn ra' : ''}
          </p>
        </div>
        {isCurrentPeriod && <Badge variant="outline" className="shrink-0">Đang diễn ra</Badge>}
      </div>
      {hasData ? (
        <div role="img" aria-label={`${data.trendTitle}: ${series.length
          ? series.map((item) => `${item.label}: ${item.values.map((value, index) => `${data.trend[index]?.label ?? index}, ${formatNumber(value, 2)}`).join('; ')}`).join('. ')
          : data.trend.map(({ label, value }) => `${label}, ${formatNumber(value, 2)}`).join('; ')}`}>
          <div className="reports-chart-plot">
            {data.trend.map((point, index) => {
              const height = point.value > 0 && maximum > 0 ? Math.max(4, (point.value / maximum) * 100) : 0;
              const displayedValue = data.trendFormat === 'currency'
                ? formatCompactCurrency(point.value)
                : formatNumber(point.value);
              return (
                <div className="reports-chart-bar-column" key={`${point.label}-${index}`} title={`${point.label}: ${displayedValue}`}>
                  <span className="reports-chart-value">{point.value > 0 ? displayedValue : '0'}</span>
                  {series.length ? (
                    <div className="flex min-h-0 w-full flex-1 items-end justify-center gap-[2px]" aria-hidden="true">
                      {series.map((item, seriesIndex) => {
                        const value = item.values[index] ?? 0;
                        const seriesHeight = value > 0 && maximum > 0 ? Math.max(3, (value / maximum) * 100) : 0;
                        return (
                          <div
                            className={`reports-chart-bar${index === activeIndex ? ' is-current' : ''}`}
                            key={item.id}
                            style={{
                              height: `${seriesHeight}%`,
                              width: `${Math.min(32, 100 / series.length)}px`,
                              backgroundColor: `var(--chart-${seriesIndex % 5 + 1})`,
                            }}
                            title={`${item.label}: ${formatCompactCurrency(value)}`}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className={`reports-chart-bar${index === activeIndex ? ' is-current' : ''}`}
                      style={{ height: `${height}%` }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="reports-chart-labels" aria-hidden="true">
            {data.trend.map(({ label }, index) => <span key={`${label}-${index}`}>{label}</span>)}
          </div>
          {series.length > 0 && (
            <>
              <ul aria-label="Chú giải tư vấn viên" className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                {series.map((item, index) => (
                  <li className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" key={item.id}>
                    <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: `var(--chart-${index % 5 + 1})` }} aria-hidden="true" />
                    <span className="max-w-40 truncate" title={item.label}>{item.label}</span>
                  </li>
                ))}
              </ul>
              <div aria-label="Chi tiết giải ngân theo tư vấn viên và kỳ" className="reports-series-data mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-xs tabular-nums">
                  <thead>
                    <tr className="border-y border-border bg-muted/40 text-muted-foreground">
                      <th className="sticky left-0 z-[1] bg-muted px-3 py-2 text-left font-medium">Tư vấn viên</th>
                      {data.trend.map(({ label }, index) => (
                        <th className="whitespace-nowrap px-3 py-2 text-right font-medium" key={`${label}-${index}`}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((item, seriesIndex) => (
                      <tr className="border-b border-border last:border-0" key={item.id}>
                        <th className="sticky left-0 max-w-36 truncate bg-card px-3 py-2 text-left font-medium text-foreground" title={item.label} scope="row">
                          <span className="mr-2 inline-block size-2 rounded-sm" style={{ backgroundColor: `var(--chart-${seriesIndex % 5 + 1})` }} aria-hidden="true" />
                          {item.label}
                        </th>
                        {data.trend.map(({ label }, index) => (
                          <td className="whitespace-nowrap px-3 py-2 text-right text-foreground" key={`${label}-${index}`}>
                            {formatCompactCurrency(item.values[index] ?? 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="reports-chart-empty" role="status">Chưa có dữ liệu trong kỳ này.</div>
      )}
    </Card>
  );
}

function ReportStatuses({ data }: { data: ReportPayload }) {
  return (
    <Card className="min-w-0 gap-0 border-border bg-card px-4 py-4 shadow-none sm:px-5 sm:py-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-foreground">{data.report === 'customers' ? 'Khách hàng theo trạng thái' : data.report === 'plans' ? 'Kế hoạch theo trạng thái' : 'Hồ sơ vay theo trạng thái'}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Trạng thái hiện tại của hồ sơ tạo trong kỳ</p>
      </div>
      {data.statuses.length ? (
        <ul className="divide-y divide-border">
          {data.statuses.map((status) => (
            <li className="flex min-h-10 items-center justify-between gap-3 py-2" key={status.key}>
              <Badge variant="outline" className={`shrink-0 ${statusBadgeClass(status.key)}`}>{status.label}</Badge>
              <span className="text-right text-sm tabular-nums text-foreground">
                {formatNumber(status.count)}
                <span className="ml-2 text-xs text-muted-foreground">{formatNumber(status.percentage, 1)}%</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">Chưa có hồ sơ trong kỳ này.</p>
      )}
    </Card>
  );
}

function ReportTable({ table }: { table: ReportPayload['table'] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const updateScrollState = () => {
      setCanScrollLeft(node.scrollLeft > 1);
      setCanScrollRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    };
    updateScrollState();
    node.addEventListener('scroll', updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', updateScrollState);
      observer.disconnect();
    };
  }, [table.columns.length, table.rows.length]);

  const hasOverflow = canScrollLeft || canScrollRight;
  const maskImage = hasOverflow
    ? `linear-gradient(to right, ${canScrollLeft ? 'transparent' : '#000'} 0, #000 28px, #000 calc(100% - 28px), ${canScrollRight ? 'transparent' : '#000'} 100%)`
    : 'none';

  return (
    <Card className="min-w-0 gap-0 overflow-hidden border-border bg-card py-0 shadow-none">
      <header className="px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-foreground">{table.title}</h2>
        {table.description && <p className="mt-1 text-xs text-muted-foreground">{table.description}</p>}
      </header>
      {table.rows.length ? (
        <div className="reports-table-frame">
          <div ref={scroller} className="reports-table-viewport overflow-x-auto" style={{ maskImage, WebkitMaskImage: maskImage }}>
            <table className="w-full border-collapse text-left text-sm" style={{ minWidth: table.columns.length > 5 ? 900 : 680 }}>
              <thead>
                <tr className="border-y border-border bg-muted/40 text-xs text-muted-foreground">
                  {table.columns.map((column, index) => (
                    <th
                      className={`h-10 whitespace-nowrap px-4 font-medium ${index === 0 ? 'sticky left-0 z-[1] bg-muted' : ''} ${['number', 'currency', 'percent'].includes(column.format ?? '') ? 'text-right' : ''}`}
                      key={column.key}
                      scope="col"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr className="border-b border-border last:border-0 hover:bg-muted/30" key={String(row.id ?? rowIndex)}>
                    {table.columns.map((column, columnIndex) => {
                      const value = row[column.key];
                      return (
                        <td
                          className={`h-11 max-w-[320px] whitespace-nowrap px-4 text-foreground ${columnIndex === 0 ? 'sticky left-0 z-[1] bg-card font-medium' : ''} ${['number', 'currency', 'percent'].includes(column.format ?? '') ? 'text-right tabular-nums' : ''}`}
                          key={column.key}
                          title={typeof value === 'string' ? value : undefined}
                        >
                          {column.format === 'status'
                            ? <Badge variant="outline" className={statusBadgeClass(String(value ?? ''))}>{value ?? '—'}</Badge>
                            : column.format === 'currency' && value !== null
                              ? formatFullCurrency(String(value))
                              : column.format === 'number' && value !== null
                                ? formatNumber(Number(value))
                                : column.format === 'percent' && value !== null
                                  ? `${formatNumber(Number(value), 2)}%`
                                : value ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {table.footer && (
                <tfoot>
                  <tr className="border-t border-border bg-muted/40 font-semibold">
                    {table.columns.map((column, columnIndex) => {
                      const value = table.footer?.[column.key];
                      return (
                        <td
                          className={`h-11 whitespace-nowrap px-4 text-foreground ${columnIndex === 0 ? 'sticky left-0 z-[1] bg-muted font-semibold' : ''} ${['number', 'currency', 'percent'].includes(column.format ?? '') ? 'text-right tabular-nums' : ''}`}
                          key={column.key}
                        >
                          {column.format === 'currency' && value !== null && value !== undefined
                            ? formatFullCurrency(String(value))
                            : column.format === 'number' && value !== null && value !== undefined
                              ? formatNumber(Number(value))
                              : column.format === 'percent' && value !== null && value !== undefined
                                ? `${formatNumber(Number(value), 2)}%`
                                : value ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {canScrollLeft && (
            <Button
              aria-label="Cuộn bảng sang trái"
              className="reports-table-scroll-button left-2"
              onClick={() => scroller.current?.scrollBy({ left: -scroller.current.clientWidth * 0.8, behavior: 'smooth' })}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
          )}
          {canScrollRight && (
            <Button
              aria-label="Cuộn bảng sang phải"
              className="reports-table-scroll-button right-2"
              onClick={() => scroller.current?.scrollBy({ left: scroller.current.clientWidth * 0.8, behavior: 'smooth' })}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </div>
      ) : (
        <p className="px-5 pb-5 text-sm text-muted-foreground">Chưa có bản ghi trong kỳ này.</p>
      )}
    </Card>
  );
}

export function ReportsPage({ reportType }: { reportType: ReportType }) {
  const { session } = useCrmSession();
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [offset, setOffset] = useState(0);
  const [branchId, setBranchId] = useState('');
  const [adviserId, setAdviserId] = useState('');
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const definition = reportDefinitions[reportType];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ period, offset: String(offset) });
    if (branchId) params.set('branchId', branchId);
    if (adviserId) params.set('adviserId', adviserId);
    void request<ReportPayload>(`/reports/${reportType}?${params.toString()}`, {}, session?.accessToken)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải báo cáo.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [adviserId, branchId, offset, period, reloadKey, reportType, session?.accessToken]);

  const isCurrentPeriod = offset === 0;
  const statusHeading = useMemo(() => {
    if (reportType === 'customers') return 'Khách hàng theo trạng thái';
    if (reportType === 'plans') return 'Kế hoạch theo trạng thái';
    return 'Hồ sơ vay theo trạng thái';
  }, [reportType]);

  return (
    <WorkspaceLayout activeSection={definition.section} requiredPermission="reports.read">
      <div className="reports-page mx-auto w-full max-w-[1440px] min-w-0">
        <header className="mb-5 flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">{definition.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
          </div>
          <Button
            aria-label="Tải lại báo cáo"
            className="shrink-0"
            disabled={loading}
            onClick={() => setReloadKey((key) => key + 1)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <RotateCw aria-hidden="true" className={loading ? 'animate-spin' : ''} />
          </Button>
        </header>

        <section aria-label="Bộ lọc báo cáo" className="mb-4 flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="grid w-full grid-cols-5 gap-1 rounded-lg bg-muted p-1 sm:w-auto">
              {periodOptions.map((option) => (
                <Button
                  aria-pressed={period === option.value}
                  className={`h-8 min-w-0 px-2 text-xs ${period === option.value ? 'bg-card text-foreground' : 'text-muted-foreground'}`}
                  key={option.value}
                  onClick={() => {
                    setPeriod(option.value);
                    setOffset(0);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {data?.filters.access !== 'self' && data && (
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <Select
                  value={branchId}
                  onValueChange={(value) => {
                    if (typeof value !== 'string') return;
                    setBranchId(value);
                    setAdviserId('');
                  }}
                >
                  <SelectTrigger aria-label="Lọc theo chi nhánh" className="h-9 w-full bg-card text-base md:text-sm">
                    <SelectValue placeholder="Tất cả chi nhánh">
                      {data.filters.branches.find(({ id }) => id === branchId)?.name ?? 'Tất cả chi nhánh'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="">Tất cả chi nhánh</SelectItem>
                    {data.filters.branches.map(({ id, name }) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={adviserId}
                  onValueChange={(value) => {
                    if (typeof value === 'string') setAdviserId(value);
                  }}
                >
                  <SelectTrigger aria-label="Lọc theo tư vấn viên" className="h-9 w-full bg-card text-base md:text-sm">
                    <SelectValue placeholder="Tất cả tư vấn viên">
                      {data.filters.advisers.find(({ id }) => id === adviserId)?.name ?? 'Tất cả tư vấn viên'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="">Tất cả tư vấn viên</SelectItem>
                    {data.filters.advisers.map(({ id, name }) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {data && (
              <p className="text-xs text-muted-foreground sm:ml-2">
                Phạm vi: {data.filters.access === 'self'
                  ? 'Dữ liệu của bạn'
                  : data.filters.access === 'all'
                    ? 'Toàn hệ thống'
                    : branchId
                      ? data.filters.branches.find(({ id }) => id === branchId)?.name ?? 'Chi nhánh được phân công'
                      : 'Các chi nhánh được phân công'}
                {adviserId ? ` · ${data.filters.advisers.find(({ id }) => id === adviserId)?.name ?? 'Tư vấn viên đã chọn'}` : ''}
              </p>
            )}
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2 lg:justify-end">
            <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-foreground sm:text-sm">
              <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{data ? periodRangeLabel(data) : 'Đang tải kỳ báo cáo…'}</span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label="Kỳ trước"
                className="size-8"
                onClick={() => setOffset((value) => value - 1)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                aria-label="Kỳ tiếp theo"
                className="size-8"
                disabled={offset >= 0}
                onClick={() => setOffset((value) => Math.min(0, value + 1))}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>

        {error && <Toast message={error} variant="error" onDismiss={() => setError('')} action={<Button onClick={() => setReloadKey((key) => key + 1)} size="sm" type="button" variant="outline">Thử lại</Button>} />}

        {loading && !data ? (
          <div aria-busy="true" className="space-y-4">
            <Skeleton className="h-28 rounded-xl" />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(220px,.85fr)]">
              <Skeleton className="h-72 rounded-xl" />
              <Skeleton className="h-72 rounded-xl" />
            </div>
            <Skeleton className="h-60 rounded-xl" />
          </div>
        ) : data ? (
          <>
            <section aria-label="Chỉ số chính" className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
              {data.metrics.map((metric) => (
                <div className="min-w-0 bg-card p-4 sm:p-5" key={metric.key}>
                  <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                  <p className="mt-2 break-words text-xl font-semibold tabular-nums text-foreground sm:text-2xl" title={metric.format === 'currency' ? formatFullCurrency(String(metric.value ?? 0)) : undefined}>
                    {metricValue(metric)}
                  </p>
                  {metric.detail && <p className="mt-1 text-xs leading-5 text-muted-foreground">{metric.detail}</p>}
                </div>
              ))}
            </section>

            <div className="mb-4 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(220px,.85fr)]">
              <ReportChart data={data} isCurrentPeriod={isCurrentPeriod} />
              <section aria-label={statusHeading}>
                <ReportStatuses data={data} />
              </section>
            </div>

            {data.staffTable && <div className="mb-4"><ReportTable table={data.staffTable} /></div>}
            <ReportTable table={data.table} />
            <p className="mt-3 text-xs text-muted-foreground">
              Múi giờ Asia/Ho_Chi_Minh · Dữ liệu giới hạn theo quyền báo cáo của tài khoản.
            </p>
          </>
        ) : null}
      </div>
    </WorkspaceLayout>
  );
}
