import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, Ref } from 'react';
import ReactEChartsModule from 'echarts-for-react';
import { connect } from 'echarts';
import type { ECharts, EChartsOption } from 'echarts';

// echarts-for-react ships CommonJS (`exports.default`) plus an ESM build.
// Bundlers hand us the component itself; Node's CJS interop (and TypeScript
// under NodeNext) hands us the module object. Accept both.
type EChartsReactComponent = typeof ReactEChartsModule.default;
const ReactECharts: EChartsReactComponent =
  (ReactEChartsModule as unknown as { default?: EChartsReactComponent }).default ??
  (ReactEChartsModule as unknown as EChartsReactComponent);

export type ChartEventHandler = (params: unknown, chart: ECharts) => void;

export interface CanopyChartInitOptions {
  /** Default 'canvas' (fastest for large live series). */
  renderer?: 'canvas' | 'svg';
  devicePixelRatio?: number;
  locale?: string;
}

export interface CanopyChartProps {
  option: EChartsOption;
  /**
   * Components replaced (not merged) on update, e.g. ['series', 'yAxis'] when
   * series come and go. Don't give those components `id`s (react-trace footgun:
   * id matching pins survivors to their old index).
   */
  replaceMerge?: string | string[];
  /** Replace the whole option on update instead of merging. */
  notMerge?: boolean;
  /** Defer rendering the update to the next animation frame. */
  lazyUpdate?: boolean;
  /**
   * `echarts.connect` group: charts sharing a group share tooltip/axis-pointer
   * and dataZoom. Set on the instance before connecting, and re-applied when
   * the instance is recreated.
   */
  group?: string;
  /** ECharts events → handlers. Handlers may change identity freely; the chart is not rebound. */
  onEvents?: Record<string, ChartEventHandler>;
  /** Called with each new ECharts instance (after the first render, and after any re-init). */
  onReady?(chart: ECharts): void;
  /** ECharts init options. Changing them re-creates the instance. */
  opts?: CanopyChartInitOptions;
  /** Wrapper style. The chart fills the wrapper, which defaults to 100% × 100%. */
  style?: CSSProperties;
  className?: string;
  /** Accessible name; the wrapper becomes role="img". */
  ariaLabel?: string;
  /** Ref to the wrapper div — attach pointer listeners here, not to ECharts' zrender. */
  ref?: Ref<HTMLDivElement>;
}

function applyGroup(chart: ECharts, group: string | undefined): void {
  if (group) {
    chart.group = group;
    connect(group);
  } else if (chart.group) {
    chart.group = '';
  }
}

const FILL: CSSProperties = { width: '100%', height: '100%' };

/**
 * The standard ECharts wrapper (react-trace's recipe): canvas renderer, a
 * wrapper div for pointer listeners, stable event bindings, connect-group
 * handling, and no `theme` prop (it would re-create the instance and drop it
 * from its group — theme through the option instead, see `baseChartOption`).
 * Throttle how often `option` changes for live data; connected charts
 * rebroadcast axis-pointer and dataZoom actions to each other.
 */
export function CanopyChart({
  option,
  replaceMerge,
  notMerge,
  lazyUpdate,
  group,
  onEvents,
  onReady,
  opts,
  style,
  className,
  ariaLabel,
  ref,
}: CanopyChartProps) {
  const chartRef = useRef<ECharts | null>(null);
  const mountedRef = useRef(false);
  const latest = useRef({ group, onEvents, onReady });

  useEffect(() => {
    latest.current = { group, onEvents, onReady };
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      chartRef.current = null;
    };
  }, []);

  // One trampoline per event name, stable while the set of names is: the
  // handlers themselves are read from `latest` at call time.
  const eventKey = onEvents ? Object.keys(onEvents).sort().join('\n') : '';
  const boundEvents = useMemo(() => {
    const out: Record<string, ChartEventHandler> = {};
    for (const name of eventKey ? eventKey.split('\n') : []) {
      out[name] = (params, chart) => {
        if (chart.isDisposed()) return;
        latest.current.onEvents?.[name]?.(params, chart);
      };
    }
    return out;
  }, [eventKey]);

  // `instance` is typed loosely: echarts-for-react's CommonJS typings resolve a
  // second copy of the echarts declarations that TypeScript won't unify.
  const handleReady = useCallback((instance: unknown) => {
    const chart = instance as ECharts;
    // echarts-for-react initializes asynchronously; a chart that becomes ready
    // after unmount is orphaned, so release it.
    if (!mountedRef.current) {
      if (!chart.isDisposed()) chart.dispose();
      return;
    }
    chartRef.current = chart;
    applyGroup(chart, latest.current.group);
    latest.current.onReady?.(chart);
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart && !chart.isDisposed()) applyGroup(chart, group);
  }, [group]);

  const classes = ['canopy-chart', className].filter(Boolean).join(' ');

  return (
    <div
      ref={ref}
      className={classes}
      style={{ position: 'relative', ...FILL, ...style }}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
    >
      <ReactECharts
        option={option}
        notMerge={notMerge}
        replaceMerge={replaceMerge}
        lazyUpdate={lazyUpdate}
        opts={{ renderer: 'canvas', ...opts }}
        onEvents={boundEvents}
        onChartReady={handleReady}
        style={FILL}
      />
    </div>
  );
}
