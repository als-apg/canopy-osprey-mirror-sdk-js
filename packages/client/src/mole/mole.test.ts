import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../hare/HarePVService.js';
import type { CanopyConnection } from '../rest/canopyFetch.js';
import { fetchData, fetchMetadata, listArchivers, searchPVs } from './mole.js';
import type { ArchiverSeriesDTO } from './types.js';

function makeConn(payload: unknown): { conn: CanopyConnection; fetchFn: ReturnType<typeof vi.fn> } {
  const fetchFn = vi.fn<FetchLike>(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  }));
  return { conn: { baseUrl: 'http://host', apiKey: 'secret-key', fetch: fetchFn }, fetchFn };
}

describe('mole', () => {
  it('fetchData GETs /mole/v1/data/{pv} with the documented query aliases', async () => {
    const series: ArchiverSeriesDTO = {
      mode: 'raw',
      pv: 'DEMO:BPM1:X',
      archiver: 'appliance',
      from: 1,
      to: 2,
      decimated: false,
      samples: [{ tsNs: 1, value: 3.2, severity: 'NO_ALARM', source: 'archive' }],
    };
    const { conn, fetchFn } = makeConn(series);

    const result = await fetchData(conn, 'DEMO:BPM1:X', {
      fromNs: 1,
      toNs: 2,
      binning: 'time',
      maxPoints: 500,
      binSizeNs: 1_000_000_000,
      includeLastBefore: true,
    });

    expect(result).toEqual(series);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(
      'http://host/mole/v1/data/DEMO%3ABPM1%3AX?from=1&to=2&binning=time&maxPoints=500&binSize=1000000000&includeLastBefore=true'
    );
    expect(init.method).toBe('GET');
    expect(init.headers['X-API-Key']).toBe('secret-key');
  });

  it('fetchData omits every optional param that was not provided', async () => {
    const { conn, fetchFn } = makeConn({});
    await fetchData(conn, 'X', { fromNs: 42 });
    expect(fetchFn.mock.calls[0]![0]).toBe('http://host/mole/v1/data/X?from=42');
  });

  it('fetchMetadata GETs /mole/v1/metadata/{pv} with the optional archiver', async () => {
    const { conn, fetchFn } = makeConn({ pv: 'X', archiver: 'appliance' });
    await fetchMetadata(conn, 'ca://X/Y', 'appliance');
    expect(fetchFn.mock.calls[0]![0]).toBe(
      'http://host/mole/v1/metadata/ca%3A%2F%2FX%2FY?archiver=appliance'
    );
  });

  it('searchPVs GETs /mole/v1/search and listArchivers GETs /mole/v1/archivers', async () => {
    const search = makeConn({ archiver: 'a', pattern: 'DEMO.*', pvs: ['DEMO:BPM1:X'] });
    await searchPVs(search.conn, 'DEMO.*', { limit: 10 });
    expect(search.fetchFn.mock.calls[0]![0]).toBe(
      'http://host/mole/v1/search?pattern=DEMO.*&limit=10'
    );

    const list = makeConn({ default: 'a', archivers: [] });
    await expect(listArchivers(list.conn)).resolves.toEqual({ default: 'a', archivers: [] });
    expect(list.fetchFn.mock.calls[0]![0]).toBe('http://host/mole/v1/archivers');
  });
});
