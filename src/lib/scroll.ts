/**
 * Row-unit scroll model for the log list.
 *
 * The list does not use native scrolling: a spacer div of `total * rowH` pixels
 * hits the engine's maximum element height (33,554,432px in Chromium/WebView2),
 * which silently clamps the scrollable area — at a 29px row that is 1,157,049
 * rows, and everything past it becomes unreachable. Multi-million-entry logs are
 * normal here, so the scroll position is a fractional row index instead, and the
 * scrollbar is drawn by us. Desktop log viewers (klogg, EmEditor) and Monaco do
 * the same thing for the same reason.
 *
 * Every function is pure: geometry in, geometry out. `viewH` and `rowH` are
 * pixels, `row` counts entries and may be fractional (sub-row scrolling).
 */

export type Align = "auto" | "center" | "start";

/** Rows that fit in the viewport, fractional (a half-visible row still counts). */
export const visibleRows = (viewH: number, rowH: number) => viewH / Math.max(1, rowH);

/** Largest valid scroll position: the last screenful, never negative. */
export const maxRow = (total: number, viewH: number, rowH: number) =>
  Math.max(0, total - visibleRows(viewH, rowH));

export const clampRow = (row: number, total: number, viewH: number, rowH: number) =>
  Math.min(Math.max(0, row), maxRow(total, viewH, rowH));

/** Half-open range of rows to render, padded by `overscan` on both sides. */
export const rangeOf = (
  row: number,
  total: number,
  viewH: number,
  rowH: number,
  overscan = 10,
): { start: number; end: number } => {
  const first = Math.floor(row);
  const span = Math.ceil(visibleRows(viewH, rowH)) + 1;
  return {
    start: Math.max(0, first - overscan),
    end: Math.max(0, Math.min(total, first + span + overscan)),
  };
};

/** Wheel delta → rows. deltaMode: 0 = pixels, 1 = lines, 2 = pages. */
export const wheelRows = (deltaY: number, deltaMode: number, rowH: number, viewH: number) =>
  deltaMode === 1
    ? deltaY
    : deltaMode === 2
      ? deltaY * visibleRows(viewH, rowH)
      : deltaY / Math.max(1, rowH);

/** Scroll position that brings `index` into view. "auto" stays put if it already is. */
export const alignRow = (
  index: number,
  cur: number,
  total: number,
  viewH: number,
  rowH: number,
  align: Align = "auto",
): number => {
  const vis = visibleRows(viewH, rowH);
  if (align === "center") return clampRow(index - vis / 2 + 0.5, total, viewH, rowH);
  if (align === "start") return clampRow(index, total, viewH, rowH);
  if (index <= cur) return clampRow(index, total, viewH, rowH);
  if (index > cur + vis - 1) return clampRow(index - vis + 1, total, viewH, rowH);
  return cur;
};

/** Thumb geometry in track pixels, or null when everything already fits. */
export const thumbOf = (
  row: number,
  total: number,
  viewH: number,
  rowH: number,
  trackH: number,
  minH = 24,
): { top: number; height: number } | null => {
  const vis = visibleRows(viewH, rowH);
  if (total <= vis || trackH <= 0) return null;
  const height = Math.min(trackH, Math.max(minH, Math.round((vis / total) * trackH)));
  const max = maxRow(total, viewH, rowH);
  const top = max <= 0 ? 0 : Math.round((row / max) * (trackH - height));
  return { top, height };
};

/**
 * Scrollbar marker map geometry.
 *
 * Markers live in the span the thumb's *centre* can reach — `[thumbH/2,
 * trackH - thumbH/2]` — not the full track. The thumb's top only ever reaches
 * `trackH - thumbH`, so a map painted over the full track drifts from the thumb
 * by up to `thumbH`; with the 24px minimum thumb height on a multi-million-row
 * file that is tens of thousands of rows, and the bottom of the map is not
 * reachable at all. Painting into the same span makes "marker under the thumb
 * centre" mean "that content is on screen".
 */
export const markBuckets = (trackH: number, thumbH: number) =>
  Math.max(1, Math.round(trackH - thumbH));

/** Track y of bucket 0's top edge. */
export const markOffset = (thumbH: number) => thumbH / 2;

/** Bucket a view row is painted in. */
export const bucketOfRow = (row: number, total: number, buckets: number) =>
  Math.min(buckets - 1, Math.max(0, Math.floor((row * buckets) / Math.max(1, total))));

/** First row of a bucket — where a click on it lands when it holds no marker. */
export const rowOfBucket = (bucket: number, total: number, buckets: number) =>
  (bucket * total) / Math.max(1, buckets);

/** Bucket under a track y (y being where the thumb's centre would sit). */
export const bucketAtY = (y: number, thumbH: number, buckets: number) =>
  Math.min(buckets - 1, Math.max(0, Math.floor(y - markOffset(thumbH))));

/** Track y of the thumb's top edge → scroll position. Used by drag and track clicks. */
export const rowAtY = (
  y: number,
  trackH: number,
  thumbH: number,
  total: number,
  viewH: number,
  rowH: number,
) => clampRow((y / Math.max(1, trackH - thumbH)) * maxRow(total, viewH, rowH), total, viewH, rowH);
