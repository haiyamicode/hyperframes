import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";
import type { RuntimePlayerSeekOptions } from "./types";

const EXACT: RuntimePlayerSeekOptions = { exact: true };

/**
 * A loaded line of speech that starts between two 30 fps frames, every time the runtime moves it
 * to, and a way to put it somewhere without the runtime.
 */
function mountLineBetweenFrames(start: number) {
  resetRuntimeFixtureDom();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  document.body.innerHTML =
    '<div data-composition-id="main" data-root="true" data-duration="10">' +
    `<audio id="line" data-start="${start}" data-duration="2" src="/line.mp3"></audio>` +
    "</div>";
  const line = document.getElementById("line") as HTMLAudioElement;
  Object.defineProperty(line, "duration", { value: 2, configurable: true });
  Object.defineProperty(line, "readyState", { value: 4, configurable: true });
  line.play = vi.fn(() => Promise.resolve());
  line.pause = vi.fn();
  line.load = vi.fn();
  const moves: number[] = [];
  let position = 0;
  Object.defineProperty(line, "currentTime", {
    configurable: true,
    get: () => position,
    set: (time: number) => {
      position = time;
      moves.push(time);
    },
  });
  window.__timelines = { main: createMockTimeline(10) };
  initSandboxRuntimeModular();
  return {
    line,
    moves,
    place: (time: number) => {
      position = time;
    },
  };
}

it("lands an exact seek on its time, and a plain seek on the frame at or before it", () => {
  mountLineBetweenFrames(1.024);
  window.__player!.seek(1.024, EXACT);
  expect(window.__player!.getTime()).toBe(1.024);
  window.__player!.seek(1.024);
  expect(window.__player!.getTime()).toBe(1);
});

it("plays a clip that starts between frames from its first moment after an exact seek to its start", () => {
  const { line, place } = mountLineBetweenFrames(1.024);
  place(0.5);
  window.__player!.seek(1.024, EXACT);
  window.__player!.play();
  expect(line.currentTime).toBeGreaterThanOrEqual(0);
  expect(line.currentTime).toBeLessThan(0.001);
});

it("leaves media already where play starts it, since a seek there restarts its sound", () => {
  const { moves } = mountLineBetweenFrames(1.024);
  window.__player!.seek(1.024, EXACT);
  moves.length = 0;
  window.__player!.play();
  expect(moves).toEqual([]);
});

it("moves media that is elsewhere when play starts", () => {
  const { line, moves, place } = mountLineBetweenFrames(1.024);
  window.__player!.seek(1.024, EXACT);
  place(0.3);
  moves.length = 0;
  window.__player!.play();
  expect(moves.length).toBeGreaterThan(0);
  expect(line.currentTime).toBeLessThan(0.001);
});

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});
