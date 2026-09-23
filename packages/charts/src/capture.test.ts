import { describe, expect, it, vi } from 'vitest';
import type { ECharts } from 'echarts';
import { captureChartPng, dataUrlToBlob } from './capture.js';

const PNG_URL = 'data:image/png;base64,iVBORw0KGgo=';

function chart(result: unknown, extra: Record<string, unknown> = {}) {
  const getDataURL = vi.fn(() => result);
  return { chart: { getDataURL, ...extra } as unknown as Pick<ECharts, 'getDataURL'>, getDataURL };
}

describe('captureChartPng', () => {
  it('returns the PNG data URL at pixel ratio 2 by default', () => {
    const { chart: c, getDataURL } = chart(PNG_URL);
    expect(captureChartPng(c)).toBe(PNG_URL);
    expect(getDataURL).toHaveBeenCalledWith({ type: 'png', pixelRatio: 2 });
  });

  it('bakes in a background and custom pixel ratio', () => {
    const { chart: c, getDataURL } = chart(PNG_URL);
    captureChartPng(c, { background: '#161616', pixelRatio: 3 });
    expect(getDataURL).toHaveBeenCalledWith({
      type: 'png',
      pixelRatio: 3,
      backgroundColor: '#161616',
    });
  });

  it('returns null for a missing or disposed chart', () => {
    expect(captureChartPng(null)).toBeNull();
    expect(captureChartPng(undefined)).toBeNull();
    const { chart: c, getDataURL } = chart(PNG_URL, { isDisposed: () => true });
    expect(captureChartPng(c)).toBeNull();
    expect(getDataURL).not.toHaveBeenCalled();
  });

  it('returns null when ECharts throws or yields no image', () => {
    const throwing = {
      getDataURL: () => {
        throw new Error('no dom');
      },
    } as unknown as Pick<ECharts, 'getDataURL'>;
    expect(captureChartPng(throwing)).toBeNull();
    expect(captureChartPng(chart('').chart)).toBeNull();
    expect(captureChartPng(chart(undefined).chart)).toBeNull();
    expect(captureChartPng(chart('data:').chart)).toBeNull();
  });
});

async function bytesOf(blob: Blob): Promise<number[]> {
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return [...new Uint8Array(buf)];
}

describe('dataUrlToBlob', () => {
  it('decodes a base64 PNG data URL', async () => {
    const blob = dataUrlToBlob(PNG_URL);
    expect(blob.type).toBe('image/png');
    expect(await bytesOf(blob)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('decodes a percent-encoded data URL', async () => {
    const blob = dataUrlToBlob('data:image/svg+xml,%3Csvg%3E');
    expect(blob.type).toBe('image/svg+xml');
    expect(await bytesOf(blob)).toEqual([...new TextEncoder().encode('<svg>')]);
  });

  it('defaults the MIME type to image/png', () => {
    expect(dataUrlToBlob('data:;base64,AAAA').type).toBe('image/png');
  });

  it('rejects anything that is not a data: URL', () => {
    expect(() => dataUrlToBlob('https://example.org/a.png')).toThrow(TypeError);
    expect(() => dataUrlToBlob('data:image/png;base64')).toThrow(TypeError);
  });
});
