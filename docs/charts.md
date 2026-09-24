---
icon: lucide/chart-line
---

# Charts (`@slaclab/canopy-charts`)

ECharts helpers extracted from react-trace and recolored to Carbon g10/g100.
Peers: `@slaclab/canopy-shell` (same version; its color-mode store must be a
single copy), `echarts` ^6, `echarts-for-react` ^3, React 19. The full
reference is the
[package README](https://github.com/slaclab/canopy-sdk-js/tree/main/packages/charts#readme).

## Theme the option, not the chart

ECharts draws on a canvas, so Carbon's CSS tokens can't reach it. A
`ChartTheme` holds the resolved Carbon token values for g10 and g100, and the
helpers write them into the option object.

```tsx
const theme = useChartTheme(); // follows the canopy-shell color mode
const { colorMode } = useColorMode();

const option: EChartsOption = {
  ...baseChartOption(theme, { colors: CARBON_CATEGORICAL[colorMode] }),
  xAxis: { type: 'value', name: 'Iteration', ...chartAxisStyle(theme) },
  yAxis: { type: 'value', ...chartAxisStyle(theme) },
  series: [{ type: 'line', data, sampling: 'lttb', showSymbol: false }],
};
```

- **`chartThemeFor(mode)`** and **`CHART_THEMES`** are pure lookups. Apps with
  their own color-mode state use these.
- **`useChartTheme()`** is the only helper tied to the shell store.
- **`baseChartOption`** turns animation off and themes the background, axes,
  tooltip (with a dashed crosshair) and legend.
- Besides the axis and tooltip colors, a theme carries semantic marker colors
  for annotations that must not borrow a series color: `danger` (infeasible
  points, violations), `success`, `warning` (a "best" marker), `selection` (the
  selected point) and `highlight` (shaded `markArea` bands).

## `CanopyChart`

```tsx
<CanopyChart
  option={option}
  replaceMerge={['series']}
  group="run-42"
  onEvents={{ click: (params) => select(params) }}
  onReady={(chart) => charts.set('objective', chart)}
  style={{ height: 320 }}
  ariaLabel="Objective vs iteration"
/>
```

It wraps `echarts-for-react` and guards against the known pitfalls:

- **Canvas renderer by default.**
- **No `theme` prop is ever passed.** Changing `theme` re-creates the instance,
  which drops it from its connect group.
- **`group` is set on the instance before `echarts.connect(group)`.** It is
  applied again after any re-init.
- **Event handlers are bound once per event name.** Inline handlers are fine.
- **An instance that becomes ready after unmount is disposed.**
- **A wrapper div (`ref`) is the place for pointer listeners.**

!!! tip "Live data"

    Throttle how often `option` changes (about 150 ms). Connected charts
    rebroadcast axis-pointer and dataZoom actions to each other, so every update
    costs more than a single render.

## Export and formatting

| Helper                                   | Use                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `captureChartPng(chart, { background })` | PNG data URL at 2× pixel ratio, or `null` if the chart is gone                                    |
| `dataUrlToBlob(url)`                     | data: URL → `Blob`, e.g. for a logbook attachment                                                 |
| `CARBON_CATEGORICAL`, `seriesColor`      | Carbon's 14-color categorical palettes (light / dark)                                             |
| `formatAxisTick(v)`                      | Exponential below 1e-3 and from 1e6 up (react-trace)                                              |
| `formatValue(v, digits = 7)`             | Tooltip/table values: significant digits, exponential outside [1e-3, 1e7), trailing zeros trimmed |
