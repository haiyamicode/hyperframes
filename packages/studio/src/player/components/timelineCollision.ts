import type { TimelineElement } from "../store/playerStore";

/** Audio member tracks mark the audio zone, including members hidden by a group header. */
export function timelineAudioRow(
  order: number[],
  audioTracks: ReadonlySet<number>,
  groupTracks?: ReadonlyMap<number, readonly number[]>,
): number {
  return order.findIndex(
    (track) =>
      audioTracks.has(track) || groupTracks?.get(track)?.some((member) => audioTracks.has(member)),
  );
}

/**
 * Keep a landing track inside the dragged clip's kind-zone: visual clips stay in
 * the rows ABOVE the first audio lane; audio clips stay AT/BELOW it. Prevents a
 * clip from appearing to land in the wrong zone mid-drag (which normalizeToZones
 * would then snap back). `audioRow` = index in `trackOrder` of the first audio
 * lane, or -1 when there is no audio zone yet (then it's a no-op).
 */
export function clampTrackToZone(
  targetTrack: number,
  trackOrder: number[],
  audioRow: number,
  isAudio: boolean,
): number {
  if (audioRow < 0) return targetTrack;
  const row = trackOrder.indexOf(targetTrack);
  if (row < 0) return targetTrack;
  if (isAudio) return row >= audioRow ? targetTrack : (trackOrder[audioRow] ?? targetTrack);
  return row < audioRow ? targetTrack : (trackOrder[audioRow - 1] ?? targetTrack);
}

/**
 * Whether a new-track insert at boundary `insertRow` is allowed for a clip of the
 * given kind. Visual clips may only insert visual lanes (boundary at/above the top
 * of the audio zone); audio clips may only insert audio lanes (boundary at/below
 * it) — so audio clips CAN create a new audio track, and neither kind inserts into
 * the other's zone. `audioRow` = first audio lane row, or -1 (no audio zone) → any.
 */
export function isInsertAllowedForZone(
  insertRow: number,
  audioRow: number,
  isAudio: boolean,
  allowedRows?: ReadonlySet<number>,
): boolean {
  if (allowedRows && !allowedRows.has(insertRow)) return false;
  while (audioRow > 0 && allowedRows && !allowedRows.has(audioRow)) audioRow--;
  if (audioRow < 0) return true;
  return isAudio ? insertRow >= audioRow : insertRow <= audioRow;
}

/** The lanes a clip with a lane kind may take: its own, and those whose other clips share its kind. */
export function laneKindTracks(
  element: TimelineElement,
  order: readonly number[],
  elements: readonly TimelineElement[],
): ReadonlySet<number> | undefined {
  if (element.laneKind === undefined) return undefined;
  const key = element.key ?? element.id;
  const lanes = new Set(order);
  for (const other of elements) {
    if ((other.key ?? other.id) !== key && other.laneKind !== element.laneKind)
      lanes.delete(other.track);
  }
  lanes.add(element.track);
  return lanes;
}

/** The rows a clip held to `lanes` may open a track at: right above or below one of them. */
export function laneKindInsertRows(
  order: readonly number[],
  lanes: ReadonlySet<number>,
  allowed?: ReadonlySet<number>,
): ReadonlySet<number> {
  const rows = new Set<number>();
  order.forEach((track, row) => {
    if (!lanes.has(track)) return;
    for (const at of [row, row + 1]) if (!allowed || allowed.has(at)) rows.add(at);
  });
  return rows;
}

/**
 * Insert-row boundary for an out-of-range aim — a `desired` track that isn't a
 * real lane: the sentinel minTrack-1 an upward create-drag emits (#2214-adjacent
 * repro) or a beyond-the-bottom index a downward one does. Anchors the new track
 * to a boundary of the clip's OWN kind-zone so a visual insert can never land
 * past the audio zone (the old below = order.length fallback dropped it BELOW the
 * audio lanes). Above the zone (`desired` < the zone's min lane) → the zone's TOP
 * boundary; otherwise → its BOTTOM boundary (for a visual clip, the top of the
 * audio zone). `zoneTracks` = this kind's lanes, in `order` sequence.
 */
function outOfRangeZoneInsertRow(
  order: number[],
  zoneTracks: number[],
  audioRow: number,
  desired: number,
): number {
  // An empty audio zone opens below visual rows; an empty visual zone opens above audio.
  if (zoneTracks.length === 0) return audioRow < 0 ? order.length : audioRow;
  // zoneTracks preserves `order` sequence, so its ends map to the zone boundary
  // rows: above the zone's min lane → its top boundary, else its bottom.
  const zoneTop = order.indexOf(zoneTracks[0]);
  const zoneBottom = order.indexOf(zoneTracks[zoneTracks.length - 1]) + 1;
  return desired < Math.min(...zoneTracks) ? zoneTop : zoneBottom;
}

const floorCenti = (v: number) => Math.floor(v * 100 + 1e-6) / 100;
const ceilCenti = (v: number) => Math.ceil(v * 100 - 1e-6) / 100;

/** Whether `candidate` is nearer `start` than `best`; a tie goes to the later time. */
const isNearer = (candidate: number, best: number, start: number) => {
  const gap = Math.abs(candidate - start) - Math.abs(best - start);
  return gap < 0 || (gap === 0 && candidate > best);
};

/** The start nearest `start`, not below `minStart`, at which [start, start + duration) overlaps
 *  no clip on `track`. Ties go to the later time. The gap after the row's last clip always fits,
 *  so a row with no gap long enough puts the clip right after its last clip. `origin` is the
 *  clip's own start on this track: keeping it rewrites nothing, so it fits between any edges. */
export function resolveNearestFreeStart(
  elements: readonly TimelineElement[],
  track: number,
  start: number,
  duration: number,
  excludeKey: string | null,
  minStart = 0,
  origin: number | null = null,
): number {
  const busy = elements
    .filter((el) => (el.key ?? el.id) !== excludeKey && el.track === track)
    .sort((a, b) => a.start - b.start);
  let best = Number.POSITIVE_INFINITY;
  let gapStart = minStart;
  for (const el of [...busy, null]) {
    const latest = el ? floorCenti(el.start - duration) : Number.POSITIVE_INFINITY;
    if (latest >= gapStart) {
      const candidate = Math.min(Math.max(start, gapStart), latest);
      if (Math.abs(candidate - start) <= Math.abs(best - start)) best = candidate;
    }
    if (el) gapStart = Math.max(gapStart, ceilCenti(el.start + el.duration));
  }
  if (origin === null || origin < minStart || !isNearer(origin, best, start)) return best;
  // Float slack at both ends: 0.333 + 1.733 is 2.0660000000000003, a hair past a neighbour at 2.066.
  const [from, to] = [origin + 1e-6, origin + duration - 1e-6];
  const clear = busy.every((el) => !timeRangesOverlap(from, to, el.start, el.start + el.duration));
  return clear ? origin : best;
}

function groupHeaderAim(
  input: Parameters<typeof resolveZoneDropPlacement>[0],
):
  | { kind: "ordinary" | "member"; track: number }
  | { kind: "origin"; track: number; start: number } {
  const members = input.groupTracks?.get(input.desiredTrack);
  if (!members) return { kind: "ordinary", track: input.desiredTrack };
  const memberTracks = new Set(members);
  const member = input.order.find(
    (track) => memberTracks.has(track) && input.audioTracks.has(track) === input.isAudio,
  );
  if (member !== undefined) return { kind: "member", track: member };
  if (!input.origin) throw new Error("Group-header drop requires the clip origin");
  return { kind: "origin", ...input.origin };
}

/** Whether the seam at `row` may open a track for the clip. One held to lanes of its kind (`kindRows`
 *  from `laneKindInsertRows`) opens one only next to them, wherever its zone sits. */
function acceptsDeliberateInsert(
  input: Parameters<typeof resolveZoneDropPlacement>[0],
  row: number,
  audioRow: number,
  kindRows: ReadonlySet<number> | undefined,
): boolean {
  if (input.trackInsert === false) return false;
  if (kindRows) return kindRows.has(row);
  return isInsertAllowedForZone(row, audioRow, input.isAudio, input.allowedInsertRows);
}

/** `row` if a track may open there, else the nearest row above it that may (0 at the latest). */
function allowedRowAtOrAbove(row: number, allowed: ReadonlySet<number> | undefined): number {
  let at = row;
  while (at > 0 && allowed && !allowed.has(at)) at--;
  return at;
}

/** Whether an aim at no lane the clip may take leaves it on its own lane: new tracks are off, or the
 *  aim is a lane of another kind. */
function keepsOwnLane(
  input: Parameters<typeof resolveZoneDropPlacement>[0],
  desired: number,
  kindRows: ReadonlySet<number> | undefined,
): boolean {
  return input.trackInsert === false || (kindRows !== undefined && input.order.includes(desired));
}

// A deliberate seam opens a track; other aims land at the nearest free time on a row of the clip's kind.
export function resolveZoneDropPlacement(input: {
  order: number[];
  audioTracks: ReadonlySet<number>;
  elements: TimelineElement[];
  desiredTrack: number;
  deliberateInsertRow: number | null;
  allowedInsertRows?: ReadonlySet<number>;
  groupTracks?: ReadonlyMap<number, readonly number[]>;
  start: number;
  duration: number;
  dragKey: string;
  isAudio: boolean;
  /** Lowest start the clip may take (every moving clip stays at or after its host's start). */
  minStart?: number;
  /** Where the dragged clip sits now. */
  origin?: { track: number; start: number };
  /** The lanes the clip may land on; absent: any lane of its zone. */
  lanes?: ReadonlySet<number>;
  /** False: no new track opens — an aim at no allowed lane keeps the clip on its own. */
  trackInsert?: boolean;
}): { track: number; insertRow: number | null; start: number } {
  const { order, audioTracks, elements, desiredTrack, deliberateInsertRow } = input;
  const { start, duration, dragKey, isAudio, minStart } = input;
  const audioRow = timelineAudioRow(order, audioTracks, input.groupTracks);
  const kindRows = input.lanes && laneKindInsertRows(order, input.lanes, input.allowedInsertRows);

  if (
    deliberateInsertRow !== null &&
    acceptsDeliberateInsert(input, deliberateInsertRow, audioRow, kindRows)
  ) {
    return { track: desiredTrack, insertRow: deliberateInsertRow, start };
  }

  const aim = groupHeaderAim(input);
  if (aim.kind === "origin") return { track: aim.track, start: aim.start, insertRow: null };
  const firstVisibleAudioRow = order.findIndex((track) => audioTracks.has(track));
  const zoneBoundary = isAudio ? firstVisibleAudioRow : audioRow;
  const desired =
    aim.kind === "member" ? aim.track : clampTrackToZone(aim.track, order, zoneBoundary, isAudio);
  const zoneTracks = order.filter(
    (t) =>
      !input.groupTracks?.has(t) &&
      audioTracks.has(t) === isAudio &&
      (!input.lanes || input.lanes.has(t)),
  );
  if (!zoneTracks.includes(desired) && input.origin && keepsOwnLane(input, desired, kindRows)) {
    const { track, start: originStart } = input.origin;
    const freeStart = resolveNearestFreeStart(
      elements,
      track,
      start,
      duration,
      dragKey,
      minStart,
      originStart,
    );
    return { track, insertRow: null, start: freeStart };
  }
  // Only when the aim is outside the rows, or the clip's zone has no row yet.
  if (!zoneTracks.includes(desired)) {
    const desiredRow = order.indexOf(desired);
    const insertRow =
      desiredRow < 0 || zoneTracks.length === 0
        ? outOfRangeZoneInsertRow(order, zoneTracks, audioRow, desired)
        : desiredRow + 1;
    const allowedRow = allowedRowAtOrAbove(insertRow, kindRows ?? input.allowedInsertRows);
    return { track: desired, insertRow: allowedRow, start };
  }
  const origin = input.origin?.track === desired ? input.origin.start : null;
  const freeStart = resolveNearestFreeStart(
    elements,
    desired,
    start,
    duration,
    dragKey,
    minStart,
    origin,
  );
  return { track: desired, insertRow: null, start: freeStart };
}

/**
 * The row boundary a pointer opens a new track at, or null over a row. `rowFloat` is the pointer's
 * position in row units from the top of the first row. Only the empty space above the first row
 * (0) or below the last (`trackCount`) opens one: a drop anywhere on a row stays on that row.
 */
export function resolveInsertRow(rowFloat: number, trackCount: number): number | null {
  if (trackCount === 0 || rowFloat < 0) return 0;
  if (rowFloat >= trackCount) return trackCount;
  return null;
}

/** Half-open overlap test: [aStart, aEnd) intersects [bStart, bEnd). */
export function timeRangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * True when no clip on `track` overlaps [start, end) — excluding the clip
 * identified by `excludeKey` (the one being dragged).
 */
export function isLaneFree(
  elements: TimelineElement[],
  track: number,
  start: number,
  end: number,
  excludeKey: string | null,
): boolean {
  return !elements.some(
    (el) =>
      (el.key ?? el.id) !== excludeKey &&
      el.track === track &&
      timeRangesOverlap(start, end, el.start, el.start + el.duration),
  );
}
