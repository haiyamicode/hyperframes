import { afterEach, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";
import type { RuntimePlayerSeekOptions } from "./types";

const EXACT: RuntimePlayerSeekOptions = { exact: true };

/** A loaded line of speech that starts between two 30 fps frames, and every time it is moved to. */
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
  vi.spyOn(line, "currentTime", "set").mockImplementation((time) => moves.push(time));
  window.__timelines = { main: createMockTimeline(10) };
  initSandboxRuntimeModular();
  return moves;
}

it("lands an exact seek on its time, and a plain seek on the frame at or before it", () => {
  mountLineBetweenFrames(1.024);
  window.__player!.seek(1.024, EXACT);
  expect(window.__player!.getTime()).toBe(1.024);
  window.__player!.seek(1.024);
  expect(window.__player!.getTime()).toBe(1);
});

it("plays a clip that starts between frames from its first moment after an exact seek to its start", () => {
  const moves = mountLineBetweenFrames(1.024);
  window.__player!.seek(1.024, EXACT);
  moves.length = 0;
  window.__player!.play();
  expect(moves[0]).toBeGreaterThanOrEqual(0);
  expect(moves[0]).toBeLessThan(0.001);
});

afterEach(() => {
  window.__hfRuntimeTeardown?.();
  vi.restoreAllMocks();
  resetRuntimeFixtureDom();
});
