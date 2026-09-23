import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { CanopyChart } from './CanopyChart.js';

// echarts-for-react is replaced by a recorder: every render pushes its props,
// and tests fire onChartReady themselves (the real one does it asynchronously
// after a throwaway first init), which also lets them control timing.
const h = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
  connectCalls: [] as { group: string; instanceGroup: string | undefined }[],
  current: null as { group: string } | null,
}));

vi.mock('echarts-for-react', async () => {
  const React = await import('react');
  function MockECharts(props: Record<string, unknown>) {
    h.props.push(props);
    return React.createElement('div', { 'data-testid': 'echarts' });
  }
  return { default: MockECharts };
});

vi.mock('echarts', () => ({
  connect: (group: string) => {
    h.connectCalls.push({ group, instanceGroup: h.current?.group });
  },
}));

interface FakeChart {
  group: string;
  disposed: boolean;
  isDisposed: () => boolean;
  dispose: () => void;
}

function fakeChart(): FakeChart {
  const chart: FakeChart = {
    group: '',
    disposed: false,
    isDisposed: () => chart.disposed,
    dispose: () => {
      chart.disposed = true;
    },
  };
  h.current = chart;
  return chart;
}

const last = () => h.props[h.props.length - 1];
const ready = (chart: FakeChart) =>
  act(() => {
    (last().onChartReady as (c: unknown) => void)(chart);
  });

beforeEach(() => {
  h.props.length = 0;
  h.connectCalls.length = 0;
  h.current = null;
});

afterEach(() => {
  cleanup();
});

describe('CanopyChart', () => {
  it('renders a filling wrapper and forwards option/merge settings', () => {
    const option = { series: [] };
    render(
      <CanopyChart
        option={option}
        replaceMerge={['series', 'yAxis']}
        notMerge={false}
        lazyUpdate
        className="plot"
        style={{ height: 240 }}
        ariaLabel="Objective vs iteration"
      />
    );
    const wrapper = screen.getByRole('img', { name: 'Objective vs iteration' });
    expect(wrapper.classList.contains('canopy-chart')).toBe(true);
    expect(wrapper.classList.contains('plot')).toBe(true);
    expect(wrapper.style.height).toBe('240px');
    expect(wrapper.style.width).toBe('100%');

    const p = last();
    expect(p.option).toBe(option);
    expect(p.replaceMerge).toEqual(['series', 'yAxis']);
    expect(p.notMerge).toBe(false);
    expect(p.lazyUpdate).toBe(true);
    expect(p.style).toEqual({ width: '100%', height: '100%' });
  });

  it('uses the canvas renderer by default and never passes a theme', () => {
    const { rerender } = render(<CanopyChart option={{}} />);
    expect(last().opts).toEqual({ renderer: 'canvas' });
    expect('theme' in last()).toBe(false);
    rerender(<CanopyChart option={{}} opts={{ renderer: 'svg', devicePixelRatio: 2 }} />);
    expect(last().opts).toEqual({ renderer: 'svg', devicePixelRatio: 2 });
  });

  it('has no img role without an ariaLabel', () => {
    render(<CanopyChart option={{}} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('forwards ref to the wrapper div', () => {
    const ref = createRef<HTMLDivElement>();
    render(<CanopyChart option={{}} ref={ref} />);
    expect(ref.current?.classList.contains('canopy-chart')).toBe(true);
  });

  it('calls onReady with the instance', () => {
    const onReady = vi.fn();
    render(<CanopyChart option={{}} onReady={onReady} />);
    const chart = fakeChart();
    ready(chart);
    expect(onReady).toHaveBeenCalledWith(chart);
  });

  it('sets chart.group before echarts.connect(group)', () => {
    render(<CanopyChart option={{}} group="run-42" />);
    ready(fakeChart());
    expect(h.current?.group).toBe('run-42');
    expect(h.connectCalls).toEqual([{ group: 'run-42', instanceGroup: 'run-42' }]);
  });

  it('does not connect without a group', () => {
    render(<CanopyChart option={{}} />);
    ready(fakeChart());
    expect(h.connectCalls).toEqual([]);
  });

  it('re-applies the group when it changes and clears it when removed', () => {
    const { rerender } = render(<CanopyChart option={{}} group="a" />);
    const chart = fakeChart();
    ready(chart);
    rerender(<CanopyChart option={{}} group="b" />);
    expect(chart.group).toBe('b');
    expect(h.connectCalls.map((c) => c.group)).toEqual(['a', 'b']);
    rerender(<CanopyChart option={{}} />);
    expect(chart.group).toBe('');
  });

  it('re-applies the group to a re-created instance', () => {
    const onReady = vi.fn();
    render(<CanopyChart option={{}} group="g" onReady={onReady} />);
    ready(fakeChart());
    const second = fakeChart();
    ready(second);
    expect(second.group).toBe('g');
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it('disposes an instance that becomes ready after unmount', () => {
    const onReady = vi.fn();
    const { unmount } = render(<CanopyChart option={{}} onReady={onReady} />);
    const lateReady = last().onChartReady as (c: unknown) => void;
    unmount();
    const chart = fakeChart();
    lateReady(chart);
    expect(chart.disposed).toBe(true);
    expect(onReady).not.toHaveBeenCalled();
  });

  describe('events', () => {
    it('keeps bindings stable when handlers change identity, and calls the latest one', () => {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = render(<CanopyChart option={{}} onEvents={{ click: first }} />);
      const bound = last().onEvents as Record<string, (p: unknown, c: unknown) => void>;
      rerender(<CanopyChart option={{}} onEvents={{ click: second }} />);
      expect(last().onEvents).toBe(bound);

      const chart = fakeChart();
      bound.click({ dataIndex: 3 }, chart);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith({ dataIndex: 3 }, chart);
    });

    it('rebinds when the set of event names changes', () => {
      const { rerender } = render(<CanopyChart option={{}} onEvents={{ click: () => {} }} />);
      const bound = last().onEvents;
      rerender(<CanopyChart option={{}} onEvents={{ click: () => {}, datazoom: () => {} }} />);
      expect(last().onEvents).not.toBe(bound);
      expect(Object.keys(last().onEvents as object).sort()).toEqual(['click', 'datazoom']);
    });

    it('ignores events from a disposed instance', () => {
      const click = vi.fn();
      render(<CanopyChart option={{}} onEvents={{ click }} />);
      const chart = fakeChart();
      chart.disposed = true;
      (last().onEvents as Record<string, (p: unknown, c: unknown) => void>).click({}, chart);
      expect(click).not.toHaveBeenCalled();
    });

    it('passes an empty event map without onEvents', () => {
      render(<CanopyChart option={{}} />);
      expect(last().onEvents).toEqual({});
    });
  });
});
