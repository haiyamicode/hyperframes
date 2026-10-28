import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

function makeNode(kind: string) {
  const node = {
    kind,
    gain: {
      value: 1,
      cancelScheduledValues() {},
      cancelAndHoldAtTime() {},
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      setTargetAtTime() {},
    },
    connect: (dest: unknown) => dest,
    disconnect() {},
  };
  return node;
}

const captured = new Set<HTMLMediaElement>();
let outputState: "running" | "suspended" = "running";
let resumes = 0;
let finishResume: (() => void) | null = null;

class SleepyAudioContext {
  currentTime = 0;
  destination = makeNode("destination");
  onstatechange: (() => void) | null = null;
  get state() {
    return outputState;
  }
  resume() {
    resumes += 1;
    return new Promise<void>((resolve) => {
      finishResume = () => {
        outputState = "running";
        resolve();
      };
    });
  }
  suspend() {
    outputState = "suspended";
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  createGain() {
    return makeNode("gain");
  }
  createMediaElementSource(el: HTMLMediaElement) {
    captured.add(el);
    return makeNode("media-element");
  }
}

function createTimeline(duration: number): RuntimeTimelineLike {
  const s = { time: 0, paused: true };
  return {
    play: () => void (s.paused = false),
    pause: () => void (s.paused = true),
    seek: (t?: number) => (t === undefined ? s.time : (s.time = t)),
    totalTime: (t?: number) => (t === undefined ? s.time : (s.time = t)),
    time: () => s.time,
    duration: () => duration,
    add: () => {},
    paused: (v?: boolean) => (typeof v === "boolean" ? (s.paused = v) : s.paused),
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
  };
}

type MediaState = {
  paused: boolean;
  readyState: number;
  networkState: number;
  seeking: boolean;
  currentTime: number;
  duration: number;
  error: { code: number } | null;
  /** Buffered source ranges, [start, end] each. */
  buffered: [number, number][];
};

/** A media element on the network (NETWORK_LOADING), loaded by default; `media.state` drives it. */
function media(id: string, init: Partial<MediaState> = {}) {
  const el = document.getElementById(id) as HTMLMediaElement;
  const state: MediaState = {
    paused: true,
    readyState: 4,
    networkState: 2,
    seeking: false,
    currentTime: 0,
    duration: 10,
    error: null,
    buffered: [],
    ...init,
  };
  for (const key of [
    "paused",
    "readyState",
    "networkState",
    "seeking",
    "currentTime",
    "duration",
    "error",
  ] as const) {
    Object.defineProperty(el, key, {
      configurable: true,
      get: () => state[key],
      set: (value: never) => {
        state[key] = value;
      },
    });
  }
  Object.defineProperty(el, "buffered", {
    configurable: true,
    get: () => ({
      length: state.buffered.length,
      start: (i: number) => state.buffered[i]![0],
      end: (i: number) => state.buffered[i]![1],
    }),
  });
  // The browser reports both after the call returns.
  const play = vi.fn(() => {
    state.paused = false;
    queueMicrotask(() => el.dispatchEvent(new Event("playing")));
    return Promise.resolve();
  });
  el.play = play;
  el.pause = vi.fn(() => {
    state.paused = true;
    queueMicrotask(() => el.dispatchEvent(new Event("pause")));
  });
  el.load = () => {};
  return { el, state, play };
}

function mount(bodyHtml: string): void {
  document.body.innerHTML =
    `<div data-composition-id="main" data-root="true" data-start="0" data-duration="10"` +
    ` data-width="1920" data-height="1080">${bodyHtml}</div>`;
  window.__timelines = { main: createTimeline(10) };
}

const VOICE_AND_MUSIC =
  `<audio id="vo" data-start="0" data-duration="5" src="/assets/vo.mp3"></audio>` +
  `<audio id="music" data-start="0" data-duration="10" src="/assets/music.wav"></audio>`;

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

let frameCallbacks: FrameRequestCallback[] = [];
let nowMs = 0;
let wallMs = 1_000_000;
function stepFrames(count: number) {
  for (let i = 0; i < count; i++) {
    nowMs += 1000 / 60;
    wallMs += 1000 / 60;
    const pending = frameCallbacks;
    frameCallbacks = [];
    for (const cb of pending) cb(nowMs);
  }
}

async function start(bodyHtml: string, ready: Record<string, Partial<MediaState>> = {}) {
  mount(bodyHtml);
  const els = Object.fromEntries(
    [...document.querySelectorAll("audio, video")].map((el) => [el.id, media(el.id, ready[el.id])]),
  );
  initSandboxRuntimeModular();
  await flush();
  return els;
}

const waiting = () => window.__hf?.waitingForMedia?.() === true;

const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
const originalRaf = window.requestAnimationFrame;
const originalCaf = window.cancelAnimationFrame;

beforeEach(() => {
  captured.clear();
  outputState = "running";
  resumes = 0;
  finishResume = null;
  nowMs = 0;
  wallMs = 1_000_000;
  frameCallbacks = [];
  (globalThis as Record<string, unknown>).AudioContext = SleepyAudioContext;
  (globalThis as typeof globalThis & { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
  globalThis.CSS.escape ??= (v: string) => v;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frameCallbacks.push(cb);
    return frameCallbacks.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  vi.spyOn(Date, "now").mockImplementation(() => wallMs);
});

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  document.body.innerHTML = "";
  window.__timelines = {} as Record<string, RuntimeTimelineLike>;
  delete window.__player;
  delete window.__hf;
  vi.restoreAllMocks();
  (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCaf;
});

describe("Play waits for the media at the playhead", () => {
  it("holds where it starts until the media there can play, then starts all of it together", async () => {
    const { vo, music } = await start(VOICE_AND_MUSIC, { vo: { readyState: 1 } });
    window.__player!.play();
    await flush();
    stepFrames(30);
    expect(waiting()).toBe(true);
    expect(window.__player!.getTime()).toBe(0);
    expect(vo!.play).not.toHaveBeenCalled();
    expect(music!.play).not.toHaveBeenCalled();
    expect(captured.size).toBe(0);

    vo!.state.readyState = 4;
    stepFrames(1);
    await flush();
    expect(waiting()).toBe(false);
    expect(vo!.play).toHaveBeenCalled();
    expect(music!.play).toHaveBeenCalled();
    expect(captured).toEqual(new Set([vo!.el, music!.el]));
    expect(window.__player!.getTime()).toBe(0);

    for (let frame = 1; frame <= 30; frame++) {
      vo!.state.currentTime = music!.state.currentTime = frame / 60;
      stepFrames(1);
    }
    expect(window.__player!.getTime()).toBeCloseTo(0.5, 2);
  });

  it("starts at once when the media there is loaded", async () => {
    const { vo, music } = await start(VOICE_AND_MUSIC);
    window.__player!.play();
    expect(waiting()).toBe(false);
    expect(vo!.play).toHaveBeenCalled();
    expect(music!.play).toHaveBeenCalled();
  });

  it("judges media mid-seek by what it has buffered there", async () => {
    const { vo } = await start(VOICE_AND_MUSIC, {
      vo: { readyState: 1, seeking: true, currentTime: 2, buffered: [[0, 5]] },
      music: { currentTime: 2 },
    });
    window.__player!.seek(2);
    window.__player!.play();
    expect(waiting()).toBe(false);
    expect(vo!.play).toHaveBeenCalled();
  });

  it("waits for media whose buffered data ends short of the playhead", async () => {
    const { vo } = await start(VOICE_AND_MUSIC, {
      vo: { readyState: 1, seeking: true, currentTime: 2, buffered: [[0, 1]] },
      music: { currentTime: 2 },
    });
    window.__player!.seek(2);
    window.__player!.play();
    expect(waiting()).toBe(true);
    expect(vo!.play).not.toHaveBeenCalled();
  });

  it.each([
    [
      "has no source selected",
      `<audio id="vo" data-start="0" data-duration="5"></audio>`,
      {
        networkState: 0,
      },
    ],
    [
      "has no usable source",
      `<audio id="vo" data-start="0" data-duration="5"><source src="/x.mp3"></audio>`,
      {
        networkState: 3,
      },
    ],
    [
      "failed to load",
      `<audio id="vo" data-start="0" data-duration="5" src="/x.mp3"></audio>`,
      {
        error: { code: 4 },
      },
    ],
    [
      "is hidden",
      `<div data-hidden><audio id="vo" data-start="0" data-duration="5" src="/x.mp3"></audio></div>`,
      {},
    ],
    ["is not due yet", `<audio id="vo" data-start="3" data-duration="5" src="/x.mp3"></audio>`, {}],
  ] as const)("does not wait for media that %s", async (_label, html, extra) => {
    const { vo } = await start(html, { vo: { readyState: 1, ...extra } });
    window.__player!.play();
    stepFrames(1);
    expect(waiting()).toBe(false);
    expect(vo).toBeDefined();
  });

  it("waits for media given a source the browser has not started loading", async () => {
    // A `src` set just before Play reads as no source until the browser picks it up.
    const { vo, music } = await start(VOICE_AND_MUSIC, { vo: { readyState: 0, networkState: 3 } });
    window.__player!.play();
    stepFrames(1);
    expect(waiting()).toBe(true);
    expect(music!.play).not.toHaveBeenCalled();

    vo!.state.networkState = 2;
    stepFrames(1);
    expect(waiting()).toBe(true);

    vo!.state.readyState = 4;
    stepFrames(1);
    expect(waiting()).toBe(false);
    expect(vo!.play).toHaveBeenCalled();
    expect(music!.play).toHaveBeenCalled();
  });

  it("gives up on media still without data after ten seconds and plays on", async () => {
    const { vo, music } = await start(VOICE_AND_MUSIC, { vo: { readyState: 1 } });
    window.__player!.play();
    stepFrames(1);
    expect(waiting()).toBe(true);
    wallMs += 10_000;
    stepFrames(1);
    expect(waiting()).toBe(false);
    expect(music!.play).toHaveBeenCalled();
    expect(vo!.play).toHaveBeenCalled();
  });

  it("drops the hold on Pause, and the next Play starts afresh", async () => {
    const { vo } = await start(VOICE_AND_MUSIC, { vo: { readyState: 1 } });
    window.__player!.play();
    expect(waiting()).toBe(true);
    window.__player!.pause();
    expect(waiting()).toBe(false);
    stepFrames(5);
    expect(vo!.play).not.toHaveBeenCalled();
    vo!.state.readyState = 4;
    window.__player!.play();
    expect(waiting()).toBe(false);
    expect(vo!.play).toHaveBeenCalled();
  });

  it("holds mid-play when the playhead reaches media with no data, and goes on with it", async () => {
    const { vo, music } = await start(
      `<audio id="vo" data-start="1" data-duration="4" src="/assets/vo.mp3"></audio>` +
        `<audio id="music" data-start="0" data-duration="10" src="/assets/music.wav"></audio>`,
      { vo: { readyState: 1 } },
    );
    window.__player!.play();
    await flush();
    for (let frame = 1; frame <= 66; frame++) {
      if (!waiting()) music!.state.currentTime = frame / 60;
      stepFrames(1);
    }
    expect(waiting()).toBe(true);
    const heldAt = window.__player!.getTime();
    expect(heldAt).toBeGreaterThanOrEqual(1);
    expect(heldAt).toBeLessThan(1.05);
    expect(music!.state.paused).toBe(true);
    await flush();
    stepFrames(30);
    expect(window.__player!.getTime()).toBe(heldAt);

    vo!.state.readyState = 4;
    stepFrames(1);
    expect(waiting()).toBe(false);
    expect(vo!.play).toHaveBeenCalled();
    expect(music!.state.paused).toBe(false);
  });

  it("holds while the audio output is asleep, wakes it, and starts once it runs", async () => {
    outputState = "suspended";
    const { vo } = await start(VOICE_AND_MUSIC);
    window.__player!.play();
    stepFrames(10);
    expect(waiting()).toBe(true);
    expect(resumes).toBe(1);
    expect(vo!.play).not.toHaveBeenCalled();
    finishResume!();
    await flush();
    stepFrames(1);
    expect(waiting()).toBe(false);
    expect(vo!.play).toHaveBeenCalled();
  });

  it("starts without an output that has not woken within a second of Play", async () => {
    outputState = "suspended";
    const { vo } = await start(VOICE_AND_MUSIC);
    window.__player!.play();
    stepFrames(1);
    expect(waiting()).toBe(true);
    wallMs += 1000;
    stepFrames(1);
    expect(waiting()).toBe(false);
    expect(vo!.play).toHaveBeenCalled();
  });

  it("does not hold mid-play for an output gone to sleep", async () => {
    const { vo, music } = await start(VOICE_AND_MUSIC);
    window.__player!.play();
    await flush();
    for (let frame = 1; frame <= 90; frame++) {
      vo!.state.currentTime = music!.state.currentTime = frame / 60;
      stepFrames(1);
    }
    expect(music!.el.pause).not.toHaveBeenCalled();
    outputState = "suspended";
    stepFrames(1);
    expect(waiting()).toBe(false);
    expect(music!.state.paused).toBe(false);
  });

  it("does not wait for the output for media that does not sound through it", async () => {
    outputState = "suspended";
    const { clip } = await start(
      `<video id="clip" data-start="0" data-duration="5" src="/assets/clip.mp4"></video>`,
    );
    window.__player!.play();
    expect(waiting()).toBe(false);
    expect(clip!.play).toHaveBeenCalled();
  });

  it("keeps a routed element's own volume at unity through a fade", async () => {
    const { music } = await start(
      `<audio id="music" data-start="0" data-duration="10" data-fade-in="2" src="/assets/music.wav"></audio>`,
    );
    window.__player!.play();
    await flush();
    expect(captured.has(music!.el)).toBe(true);
    const volumes: number[] = [];
    let volume = music!.el.volume;
    Object.defineProperty(music!.el, "volume", {
      configurable: true,
      get: () => volume,
      set: (value: number) => {
        volume = value;
        volumes.push(value);
      },
    });
    for (let frame = 1; frame <= 60; frame++) {
      music!.state.currentTime = frame / 60;
      stepFrames(1);
    }
    expect(volumes.filter((value) => value !== 1)).toEqual([]);
  });
});
