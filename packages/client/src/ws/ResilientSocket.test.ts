import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWebSocketFactory } from '../testing/fakeWebSocket.js';
import { ResilientSocket, toWsUrl } from './ResilientSocket.js';
import type { ResilientSocketOptions, SocketError, SocketStatus } from './ResilientSocket.js';

const WS_URL = 'ws://host/optimization/v1/ws/runs';

function setup(overrides: Partial<ResilientSocketOptions> = {}) {
  const { factory, instances } = createFakeWebSocketFactory();
  const onOpen = vi.fn<ResilientSocketOptions['onOpen']>();
  const onFrame = vi.fn<ResilientSocketOptions['onFrame']>();
  const onClose = vi.fn<NonNullable<ResilientSocketOptions['onClose']>>();
  const onStatusChange = vi.fn<(status: SocketStatus) => void>();
  const onError = vi.fn<(error: SocketError) => void>();
  const socket = new ResilientSocket({
    url: WS_URL,
    webSocketFactory: factory,
    onOpen,
    onFrame,
    onClose,
    onStatusChange,
    onError,
    ...overrides,
  });
  return { socket, instances, onOpen, onFrame, onClose, onStatusChange, onError };
}

describe('ResilientSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('connect', () => {
    it('appends api_key with ? or & depending on the URL', () => {
      const plain = setup({ apiKey: 'k 1' });
      plain.socket.connect();
      expect(plain.instances[0]!.url).toBe(`${WS_URL}?api_key=k%201`);

      const withQuery = setup({ url: `${WS_URL}?x=1`, apiKey: 'k' });
      withQuery.socket.connect();
      expect(withQuery.instances[0]!.url).toBe(`${WS_URL}?x=1&api_key=k`);
    });

    it('goes idle -> connecting -> connected and runs onOpen with a working send', () => {
      const { socket, instances, onOpen, onStatusChange } = setup();
      expect(socket.status).toBe('idle');

      socket.connect();
      expect(socket.status).toBe('connecting');
      expect(onOpen).not.toHaveBeenCalled();

      onOpen.mockImplementation((send) => {
        // The status is already 'connected' when onOpen runs.
        expect(socket.status).toBe('connected');
        expect(send({ type: 'subscribe', runId: 'r1', sinceSeq: 0 })).toBe(true);
      });
      instances[0]!.open();

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(instances[0]!.parsedSent()).toEqual([{ type: 'subscribe', runId: 'r1', sinceSeq: 0 }]);
      expect(onStatusChange.mock.calls).toEqual([['connecting'], ['connected']]);
    });

    it('is idempotent while connecting or open', () => {
      const { socket, instances } = setup();
      socket.connect();
      socket.connect();
      expect(instances).toHaveLength(1);

      instances[0]!.open();
      socket.connect();
      expect(instances).toHaveLength(1);
    });

    it('throws a labelled error when no WebSocket implementation is available', () => {
      vi.stubGlobal('WebSocket', undefined);
      try {
        const socket = new ResilientSocket({
          url: WS_URL,
          label: 'RunStream',
          onOpen: vi.fn(),
          onFrame: vi.fn(),
        });
        expect(() => socket.connect()).toThrow(/^RunStream\.connect: no WebSocket implementation/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('reports ws_connect_failed with the cause and retries when the factory throws', () => {
      let calls = 0;
      const boom = new Error('bad url');
      const onError = vi.fn<(error: SocketError) => void>();
      const onStatusChange = vi.fn<(status: SocketStatus) => void>();
      const socket = new ResilientSocket({
        url: WS_URL,
        label: 'RunStream',
        webSocketFactory: () => {
          calls += 1;
          throw boom;
        },
        onOpen: vi.fn(),
        onFrame: vi.fn(),
        onError,
        onStatusChange,
      });

      socket.connect();
      expect(onError).toHaveBeenCalledExactlyOnceWith({
        code: 'ws_connect_failed',
        message: 'Could not open RunStream connection: bad url',
        cause: boom,
      });
      expect(onStatusChange.mock.calls).toEqual([['connecting'], ['disconnected']]);

      vi.advanceTimersByTime(1000);
      expect(calls).toBe(2);
    });

    it('falls back to console.warn when there is no onError', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const socket = new ResilientSocket({
        url: WS_URL,
        webSocketFactory: () => {
          throw new Error('nope');
        },
        onOpen: vi.fn(),
        onFrame: vi.fn(),
      });
      socket.connect();
      socket.close();
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        '[ResilientSocket] ws_connect_failed: Could not open ResilientSocket connection: nope'
      );
    });
  });

  describe('frames', () => {
    it('delivers parsed JSON objects and drops malformed, non-object and non-string data', () => {
      const { socket, instances, onFrame } = setup();
      socket.connect();
      const ws = instances[0]!;
      ws.open();

      ws.message({ type: 'evaluation', runId: 'r1', seq: 1 });
      ws.messageRaw('not json');
      ws.messageRaw('[1,2]');
      ws.messageRaw('null');
      ws.messageRaw('42');
      ws.messageRaw({ type: 'binary' });
      ws.message({ noType: true });

      expect(onFrame.mock.calls).toEqual([
        [{ type: 'evaluation', runId: 'r1', seq: 1 }],
        [{ noType: true }],
      ]);
    });
  });

  describe('send', () => {
    it('returns false and sends nothing unless the socket is open', () => {
      const { socket, instances } = setup();
      expect(socket.send({ type: 'x' })).toBe(false); // never connected

      socket.connect();
      expect(socket.send({ type: 'x' })).toBe(false); // connecting
      instances[0]!.open();
      expect(socket.send({ type: 'x' })).toBe(true);

      instances[0]!.close();
      expect(socket.send({ type: 'y' })).toBe(false); // dropped, backoff pending

      socket.close();
      expect(socket.send({ type: 'z' })).toBe(false); // closed
      expect(instances[0]!.parsedSent()).toEqual([{ type: 'x' }]);
    });
  });

  describe('reconnect', () => {
    it('reports the close info, reconnects on the capped backoff schedule, and resets it on open', () => {
      const { socket, instances, onClose, onOpen, onStatusChange } = setup({
        reconnectDelaysMs: [100, 200],
      });
      socket.connect();
      instances[0]!.open();

      instances[0]!.close(1006, 'abnormal');
      expect(onClose).toHaveBeenCalledExactlyOnceWith({ code: 1006, reason: 'abnormal' });
      expect(socket.status).toBe('disconnected');

      vi.advanceTimersByTime(99);
      expect(instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(instances).toHaveLength(2);

      instances[1]!.close(); // fails without opening: next delay is 200
      vi.advanceTimersByTime(199);
      expect(instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(instances).toHaveLength(3);

      instances[2]!.close(); // capped at the last entry
      vi.advanceTimersByTime(200);
      expect(instances).toHaveLength(4);

      instances[3]!.open(); // a successful open resets the schedule
      expect(onOpen).toHaveBeenCalledTimes(2);
      instances[3]!.close();
      vi.advanceTimersByTime(100);
      expect(instances).toHaveLength(5);

      expect(onStatusChange.mock.calls.slice(0, 4)).toEqual([
        ['connecting'],
        ['connected'],
        ['disconnected'],
        ['connecting'],
      ]);
    });

    it('adds up to jitterMs of random delay when configured (none by default)', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const jittered = setup({ reconnectDelaysMs: [1000], jitterMs: 250 });
      jittered.socket.connect();
      jittered.instances[0]!.close();
      vi.advanceTimersByTime(1124);
      expect(jittered.instances).toHaveLength(1);
      vi.advanceTimersByTime(1); // 1000 + round(0.5 * 250)
      expect(jittered.instances).toHaveLength(2);

      const plain = setup({ reconnectDelaysMs: [1000] });
      plain.socket.connect();
      plain.instances[0]!.close();
      vi.advanceTimersByTime(1000);
      expect(plain.instances).toHaveLength(2);
    });

    it('connect() during a pending reconnect supersedes the timer', () => {
      const { socket, instances } = setup();
      socket.connect();
      instances[0]!.open();
      instances[0]!.close();

      socket.connect();
      expect(instances).toHaveLength(2);
      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(2);
    });
  });

  describe('terminal close codes', () => {
    it('stops on 1008 by default: status closed, onClose, onError, no reconnect', () => {
      const { socket, instances, onClose, onError, onStatusChange } = setup();
      socket.connect();
      instances[0]!.open();

      instances[0]!.close(1008, 'invalid_api_key: Invalid API key');

      expect(socket.status).toBe('closed');
      expect(onStatusChange.mock.calls.at(-1)).toEqual(['closed']);
      expect(onClose).toHaveBeenCalledExactlyOnceWith({
        code: 1008,
        reason: 'invalid_api_key: Invalid API key',
      });
      expect(onError).toHaveBeenCalledExactlyOnceWith({
        code: 'ws_terminal_close',
        message:
          'ResilientSocket: server closed the connection with code 1008 (invalid_api_key: Invalid API key); not reconnecting',
      });

      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(1);

      // An explicit connect() starts it again.
      socket.connect();
      expect(instances).toHaveLength(2);
      expect(socket.status).toBe('connecting');
    });

    it('never treats 1006 (what browsers report for a rejected handshake) as terminal', () => {
      const { socket, instances, onError } = setup();
      socket.connect();
      instances[0]!.error();
      instances[0]!.close(1006);
      expect(socket.status).toBe('disconnected');
      expect(onError).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(instances).toHaveLength(2);
    });

    it('honors a custom terminalCloseCodes list, including an empty one', () => {
      const custom = setup({ terminalCloseCodes: [4001] });
      custom.socket.connect();
      custom.instances[0]!.close(4001);
      expect(custom.socket.status).toBe('closed');

      const none = setup({ terminalCloseCodes: [] });
      none.socket.connect();
      none.instances[0]!.close(1008);
      expect(none.socket.status).toBe('disconnected');
      vi.advanceTimersByTime(1000);
      expect(none.instances).toHaveLength(2);
    });
  });

  describe('heartbeat', () => {
    it('pings on the interval; any frame disarms the pong deadline', () => {
      const { socket, instances } = setup({ pingIntervalMs: 1000, pongTimeoutMs: 500 });
      socket.connect();
      const ws = instances[0]!;
      ws.open();

      vi.advanceTimersByTime(1000);
      expect(ws.parsedSent()).toEqual([{ type: 'ping' }]);

      ws.message({ type: 'evaluation', seq: 3 }); // not a pong, still proof of life
      vi.advanceTimersByTime(500);
      expect(ws.readyState).toBe(1);
    });

    it('even an unparseable frame counts as life', () => {
      const { socket, instances } = setup({ pingIntervalMs: 1000, pongTimeoutMs: 500 });
      socket.connect();
      instances[0]!.open();
      vi.advanceTimersByTime(1000);
      instances[0]!.messageRaw('garbage');
      vi.advanceTimersByTime(500);
      expect(instances[0]!.readyState).toBe(1);
    });

    it('drops a silent socket at the deadline and reconnects without waiting for its close event', () => {
      const { socket, instances, onClose } = setup({
        pingIntervalMs: 1000,
        pongTimeoutMs: 500,
      });
      socket.connect();
      const ws = instances[0]!;
      ws.open();

      vi.advanceTimersByTime(1500); // ping at 1000, deadline at 1500
      expect(ws.readyState).toBe(3);
      expect(ws.onclose).toBeNull(); // detached: a late close event is ignored
      expect(onClose).toHaveBeenCalledExactlyOnceWith({ code: undefined, reason: 'pong timeout' });
      expect(socket.status).toBe('disconnected');

      vi.advanceTimersByTime(1000);
      expect(instances).toHaveLength(2);
    });

    it('stops pinging once the socket is dropped', () => {
      const { socket, instances } = setup({ pingIntervalMs: 1000, reconnectDelaysMs: [60_000] });
      socket.connect();
      instances[0]!.open();
      instances[0]!.close();
      vi.advanceTimersByTime(5000);
      expect(instances[0]!.sent).toEqual([]);
    });
  });

  describe('orphaned sockets', () => {
    it('ignores open/message/close events from a socket that was replaced', () => {
      const { socket, instances, onOpen, onFrame, onClose } = setup();
      socket.connect();
      const first = instances[0]!;
      // Keep a handle on the first socket's handlers, then replace it.
      const staleOpen = first.onopen!;
      const staleMessage = first.onmessage!;
      const staleClose = first.onclose!;
      first.close();
      socket.connect(); // supersedes the backoff timer
      const second = instances[1]!;
      second.open();
      onOpen.mockClear();
      onClose.mockClear();

      staleOpen();
      staleMessage({ data: '{"type":"stale"}' });
      staleClose({ code: 1006 });

      expect(onOpen).not.toHaveBeenCalled();
      expect(onFrame).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(socket.status).toBe('connected');
    });

    it('does not start a heartbeat when a status listener closes the socket during open', () => {
      const onOpen = vi.fn();
      const { factory, instances } = createFakeWebSocketFactory();
      const socket: ResilientSocket = new ResilientSocket({
        url: WS_URL,
        webSocketFactory: factory,
        pingIntervalMs: 1000,
        onOpen,
        onFrame: vi.fn(),
        onStatusChange: (status) => {
          if (status === 'connected') socket.close();
        },
      });
      socket.connect();
      instances[0]!.open();
      vi.advanceTimersByTime(5000);
      expect(onOpen).not.toHaveBeenCalled();
      expect(instances[0]!.sent).toEqual([]);
      expect(socket.status).toBe('closed');
    });

    it("opens no socket when a status listener calls close() on 'connecting'", () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const socket: ResilientSocket = new ResilientSocket({
        url: WS_URL,
        webSocketFactory: factory,
        onOpen: vi.fn(),
        onFrame: vi.fn(),
        onStatusChange: (status) => {
          if (status === 'connecting') socket.close();
        },
      });
      socket.connect();
      expect(instances).toHaveLength(0);
      expect(socket.status).toBe('closed');
      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(0);
    });

    it("opens exactly one socket when a status listener calls connect() on 'connecting'", () => {
      const { factory, instances } = createFakeWebSocketFactory();
      const socket: ResilientSocket = new ResilientSocket({
        url: WS_URL,
        webSocketFactory: factory,
        onOpen: vi.fn(),
        onFrame: vi.fn(),
        onStatusChange: (status) => {
          if (status === 'connecting') socket.connect();
        },
      });
      socket.connect();
      expect(instances).toHaveLength(1);
      instances[0]!.open();
      expect(socket.status).toBe('connected');
    });
  });

  describe('close', () => {
    it('closes the socket, stops reconnecting, reports closed, and does not call onClose', () => {
      const { socket, instances, onClose, onStatusChange } = setup();
      socket.connect();
      instances[0]!.open();

      socket.close();
      expect(instances[0]!.readyState).toBe(3);
      expect(socket.status).toBe('closed');
      expect(onStatusChange.mock.calls.at(-1)).toEqual(['closed']);
      expect(onClose).not.toHaveBeenCalled();

      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(1);
    });

    it('cancels a pending reconnect', () => {
      const { socket, instances } = setup();
      socket.connect();
      instances[0]!.close();
      socket.close();
      vi.advanceTimersByTime(60_000);
      expect(instances).toHaveLength(1);
      expect(socket.status).toBe('closed');
    });
  });
});

describe('toWsUrl', () => {
  it('switches http(s) to ws(s) and keeps ws(s) bases', () => {
    expect(toWsUrl('https://canopy.example.org', '/optimization/v1/ws/runs')).toBe(
      'wss://canopy.example.org/optimization/v1/ws/runs'
    );
    expect(toWsUrl('http://localhost:8000/', '/hare/v1/ws/pvs')).toBe(
      'ws://localhost:8000/hare/v1/ws/pvs'
    );
    expect(toWsUrl('HTTPS://host/prefix//', 'fox/v1/ws/formulas')).toBe(
      'wss://host/prefix/fox/v1/ws/formulas'
    );
    expect(toWsUrl('wss://host/api', '/x')).toBe('wss://host/api/x');
  });

  it('resolves root-relative, empty and protocol-relative bases against loc', () => {
    const loc = { protocol: 'https:', host: 'app.example.org:8443', pathname: '/badger/runs/1' };
    expect(toWsUrl('/api/canopy', '/optimization/v1/ws/runs', loc)).toBe(
      'wss://app.example.org:8443/api/canopy/optimization/v1/ws/runs'
    );
    expect(toWsUrl('', '/hare/v1/ws/pvs', { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/hare/v1/ws/pvs'
    );
    expect(toWsUrl('//other:9000/c', '/x', loc)).toBe('wss://other:9000/c/x');
  });

  it('resolves path-relative bases against the page directory, like fetch would', () => {
    const loc = { protocol: 'http:', host: 'h', pathname: '/app/runs/index.html' };
    expect(toWsUrl('api/canopy', '/ws', loc)).toBe('ws://h/app/runs/api/canopy/ws');
    expect(toWsUrl('./api', '/ws', loc)).toBe('ws://h/app/runs/api/ws');
    expect(toWsUrl('../api', '/ws', loc)).toBe('ws://h/app/api/ws');
    expect(toWsUrl('api', '/ws', { protocol: 'http:', host: 'h' })).toBe('ws://h/api/ws');
  });

  it('falls back to globalThis.location, and throws without any location', () => {
    expect(() => toWsUrl('/api/canopy', '/ws')).toThrow(/without a location/);

    vi.stubGlobal('location', { protocol: 'https:', host: 'site', pathname: '/' });
    try {
      expect(toWsUrl('/api/canopy', '/ws')).toBe('wss://site/api/canopy/ws');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
