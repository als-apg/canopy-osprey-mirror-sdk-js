# @slaclab/canopy-charts

ECharts helpers shared by Canopy apps, extracted from react-trace:

- Carbon **g10 / g100 chart themes** (`CHART_THEMES`, `chartThemeFor`, `useChartTheme`)
- a themed **base option** (`baseChartOption`, `chartAxisStyle`)
- the **`CanopyChart`** wrapper around `echarts-for-react`
- **PNG capture** (`captureChartPng`, `dataUrlToBlob`)
- Carbon's **categorical palettes** (`CARBON_CATEGORICAL`, `seriesColor`)
- **number formatters** (`formatAxisTick`, `formatValue`)

## Install

Peer dependencies: `@slaclab/canopy-shell` (same version line as the
charts package), `echarts` (^6), `echarts-for-react` (^3), `react` and
`react-dom` (^19), plus the shell's own peers (`@carbon/react`,
`@carbon/icons-react`).

```sh
pnpm add @slaclab/canopy-charts @slaclab/canopy-shell echarts echarts-for-react
```

`@slaclab/canopy-shell` is a peer, not a dependency, because
`useChartTheme` reads the shell's color-mode store, which is module state:
the app and the charts must share one copy of the shell, or the charts
follow a store the app never toggles. Keep both packages on the same
version. The charts import only the shell's Carbon-free
`@slaclab/canopy-shell/color-mode` entry, so using them (even just the
formatters in a Node script) never loads `@carbon/react`; the Carbon peers
matter only to the package manager's peer check.

Apps that link the SDK locally must dedupe `echarts` along with React and
Carbon (Vite `resolve.dedupe`, see "Developing an app against a local SDK
checkout" in the root README): `echarts.connect` only links charts that
share one echarts module.

## Themes

ECharts draws on a canvas, so Carbon's CSS tokens can't reach it. A
`ChartTheme` holds the resolved token values instead, and the helpers write them
into the option object. No ECharts theme is registered.

| Field           | Carbon token         | g10 (light) | g100 (dark) |
| --------------- | -------------------- | ----------- | ----------- |
| `bg`            | `background`         | `#f4f4f4`   | `#161616`   |
| `axisLabel`     | `text-secondary`     | `#525252`   | `#c6c6c6`   |
| `axisLine`      | `border-strong-01`   | `#8d8d8d`   | `#6f6f6f`   |
| `splitLine`     | `layer-accent-01`    | `#e0e0e0`   | `#393939`   |
| `axisName`      | `text-helper`        | `#6f6f6f`   | `#a8a8a8`   |
| `tooltipBg`     | `layer-01`           | `#ffffff`   | `#262626`   |
| `tooltipBorder` | `border-subtle-01`   | `#e0e0e0`   | `#525252`   |
| `tooltipText`   | `text-primary`       | `#161616`   | `#f4f4f4`   |
| `tooltipMuted`  | `text-helper`        | `#6f6f6f`   | `#a8a8a8`   |
| `crosshair`     | `text-helper`        | `#6f6f6f`   | `#a8a8a8`   |
| `legend`        | `text-secondary`     | `#525252`   | `#c6c6c6`   |
| `danger`        | `support-error`      | `#da1e28`   | `#fa4d56`   |
| `success`       | `support-success`    | `#24a148`   | `#42be65`   |
| `warning`       | `support-warning`    | `#f1c21b`   | `#f1c21b`   |
| `selection`     | `border-interactive` | `#0f62fe`   | `#4589ff`   |
| `highlight`     | `highlight`          | `#d0e2ff`   | `#001d6c`   |

The values come from `@carbon/themes` 11.76. They match the page themes of
`@slaclab/canopy-shell` (`CARBON_THEME`: g10 light, g100 dark).

The last five are semantic marker colors, for data annotations that must not
borrow a series color: `danger` for infeasible points and violations,
`warning` for a "best" marker, `selection` for a selected point or cursor line,
and `highlight` for a shaded band (`markArea`, usually with some opacity).

- `chartThemeFor(mode)` and `CHART_THEMES` are pure lookups with no dependency
  on the shell store. Apps that keep their own color-mode state use these.
- `useChartTheme()` is the one shell-coupled helper. It returns the theme for
  the current `useColorMode()` mode.

## Building an option

```tsx
import type { EChartsOption } from 'echarts';
import {
  CARBON_CATEGORICAL,
  CanopyChart,
  baseChartOption,
  chartAxisStyle,
  formatAxisTick,
  useChartTheme,
} from '@slaclab/canopy-charts';
import { useColorMode } from '@slaclab/canopy-shell';

function ObjectiveChart({ points }: { points: [number, number][] }) {
  const theme = useChartTheme();
  const { colorMode } = useColorMode();
  const option: EChartsOption = {
    ...baseChartOption(theme, { colors: CARBON_CATEGORICAL[colorMode] }),
    xAxis: { type: 'value', name: 'Iteration', ...chartAxisStyle(theme) },
    yAxis: {
      type: 'value',
      name: 'f',
      ...chartAxisStyle(theme),
      axisLabel: { ...chartAxisStyle(theme).axisLabel, formatter: formatAxisTick },
    },
    series: [{ type: 'line', data: points, sampling: 'lttb', showSymbol: false }],
  };
  return <CanopyChart option={option} style={{ height: 320 }} ariaLabel="Objective vs iteration" />;
}
```

`baseChartOption(theme, { colors? })` returns a fresh option with the
following:

- `animation: false`
- the themed background and text
- react-trace's grid insets: 40 / 60 / 70 / 20
- a themed axis tooltip with dashed crosshair lines
- a themed legend
- default `xAxis`/`yAxis` styling with no `type`, so ECharts' own defaults apply

Spread it first, then override. When you supply your own axes (or arrays of
axes), spread `chartAxisStyle(theme)` into each one.

## `CanopyChart`

```tsx
<CanopyChart
  option={option}
  replaceMerge={['series']} // components replaced, not merged, on update
  notMerge={false}
  lazyUpdate // render the update on the next animation frame
  group="run-42" // echarts.connect group (shared tooltip/axis pointer/dataZoom)
  onEvents={{ click: (params, chart) => select(params) }}
  onReady={(chart) => registerForCapture(chart)}
  opts={{ renderer: 'canvas' }} // default; changing opts re-creates the instance
  style={{ height: 320 }} // wrapper style; default 100% x 100%
  className="badger-chart"
  ariaLabel="Objective vs iteration" // wrapper gets role="img"
  ref={wrapperRef} // the wrapper div, for pointer listeners
/>
```

It follows react-trace's recipe, with these fixes for known ECharts pitfalls:

- **Canvas renderer by default.**
- **Theming goes through the option, never a `theme` prop.** echarts-for-react
  disposes and re-creates the instance when `theme` changes, which silently
  drops the chart from its `connect` group. The component never passes one.
- **`group` is set on the instance before `echarts.connect(group)`.** It is
  applied again whenever the instance is re-created (for example after an
  `opts` change), and when the prop changes.
- **Stable event bindings.** Handlers are called through per-event trampolines,
  so inline `onEvents` handlers don't rebind on every render. Events from a
  disposed instance are ignored.
- **Safe to unmount.** echarts-for-react initializes asynchronously. An
  instance that becomes ready after unmount is disposed, and `onReady` is not
  called.
- **A wrapper div for pointer listeners.** Attach DOM listeners to the wrapper
  (`ref`), not to the zrender instance. echarts-for-react disposes and
  re-creates zrender.

Performance notes for live data (from react-trace):

- **Throttle `option` updates**, about 150 ms for streams. Connected charts
  rebroadcast axis-pointer and dataZoom actions to each other, so each update
  costs more than one chart's render.
- **Use `sampling: 'lttb'`, `showSymbol: false` and `emphasis: { disabled: true }`**
  on large line series.
- **Don't give `id`s to components listed in `replaceMerge`.** ECharts would
  match survivors by id and pin them to their old index.

In component tests, mock `echarts-for-react` (see
`src/CanopyChart.test.tsx`). jsdom has no canvas.

## Capture

```ts
import { captureChartPng, dataUrlToBlob } from '@slaclab/canopy-charts';

const url = captureChartPng(chart, { background: theme.bg }); // pixelRatio 2 by default
if (url) {
  const file = new File([dataUrlToBlob(url)], 'objective.png', { type: 'image/png' });
}
```

`captureChartPng` returns `null` instead of throwing in these cases:

- the chart is missing or disposed
- ECharts throws
- ECharts yields no image

Pass `background: theme.bg` so the PNG is legible on paper and in a logbook in
either color mode.

`dataUrlToBlob` converts base64 or percent-encoded `data:` URLs without a fetch
round-trip. This is the only copy in the SDK; a future elog package will import
it from here.

## Palettes

`CARBON_CATEGORICAL.light` and `CARBON_CATEGORICAL.dark` are Carbon's 14-color
categorical data-visualization palettes, in Carbon's order.
`seriesColor(i, mode)` cycles through them.

The values are resolved from `@carbon/colors` the way `@carbon/charts` builds
them. Three entries therefore differ from the older values listed on the Carbon
website:

- red-90: `#520408`
- magenta-50: `#ee5396`
- magenta-60: `#d02670`

## Formatters

`formatAxisTick(v)` is react-trace's tick formatter. It switches to exponential
notation below 1e-3 and at or above 1e6, for example `5.0e-4` and `1.2e+6`,
and otherwise uses the default number string.

`formatValue(v, digits = 7)` is for tooltips and tables:

- `digits` significant digits
- exponential notation below 1e-3 and at or above 1e7
- trailing zeros trimmed: `0.5`, `1.5e-5`, `1e+7`
- non-numbers are stringified
- `null` and `undefined` become `''`
