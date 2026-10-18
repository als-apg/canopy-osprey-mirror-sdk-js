import type { ECharts } from 'echarts';

export interface CaptureChartOptions {
  /**
   * Background baked into the image. Default: the chart option's own
   * `backgroundColor`. Pass `theme.bg` so the PNG stays legible on paper and
   * in a logbook in either color mode.
   */
  background?: string;
  /** Default 2 (crisp on HiDPI screens and in print). */
  pixelRatio?: number;
}

type Capturable = Pick<ECharts, 'getDataURL'> & { isDisposed?: () => boolean };

/**
 * Snapshot a mounted chart as a PNG data URL. Returns null instead of throwing
 * when the chart is missing, disposed, or yields no image.
 */
export function captureChartPng(
  chart: Pick<ECharts, 'getDataURL'> | null | undefined,
  options: CaptureChartOptions = {}
): string | null {
  if (!chart) return null;
  const c = chart as Capturable;
  try {
    if (typeof c.isDisposed === 'function' && c.isDisposed()) return null;
    const url = c.getDataURL({
      type: 'png',
      pixelRatio: options.pixelRatio ?? 2,
      ...(options.background !== undefined ? { backgroundColor: options.background } : {}),
    });
    return typeof url === 'string' && url.startsWith('data:') && url.includes(',') ? url : null;
  } catch {
    return null;
  }
}

/**
 * data: URL → Blob, without a fetch round-trip (no CSP surprises). Handles
 * base64 and percent-encoded payloads; the MIME type defaults to image/png.
 * Throws a TypeError for anything that isn't a data: URL.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma === -1) {
    throw new TypeError('dataUrlToBlob: not a data: URL');
  }
  const header = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  const params = header.split(';');
  const mime = params[0] || 'image/png';
  if (params.includes('base64')) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}
