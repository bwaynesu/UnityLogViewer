import { expect, test } from "vitest";
import {
  alignRow,
  bucketAtY,
  bucketOfRow,
  clampRow,
  markBuckets,
  markOffset,
  maxRow,
  rangeOf,
  rowAtY,
  rowOfBucket,
  thumbOf,
  wheelRows,
} from "./scroll";

// 20 rows of 29px visible in a 580px viewport
const VIEW = 580;
const ROW = 29;

test("scroll position is clamped to the last screenful", () => {
  expect(maxRow(1_578_837, VIEW, ROW)).toBe(1_578_817);
  expect(clampRow(9e9, 1_578_837, VIEW, ROW)).toBe(1_578_817);
  expect(clampRow(-5, 100, VIEW, ROW)).toBe(0);
  // a file shorter than the viewport never scrolls
  expect(maxRow(5, VIEW, ROW)).toBe(0);
});

test("entries past the old 33,554,432px pixel ceiling stay reachable", () => {
  // the row that used to be the last one a spacer div could reach
  const ceiling = Math.floor(33_554_432 / ROW);
  const total = 1_578_837;
  expect(clampRow(total - 1, total, VIEW, ROW)).toBeGreaterThan(ceiling);
  expect(rangeOf(maxRow(total, VIEW, ROW), total, VIEW, ROW).end).toBe(total);
});

test("rendered range covers the viewport plus overscan and never leaves the file", () => {
  expect(rangeOf(0, 1000, VIEW, ROW, 10)).toEqual({ start: 0, end: 31 });
  expect(rangeOf(500.4, 1000, VIEW, ROW, 10)).toEqual({ start: 490, end: 531 });
  expect(rangeOf(990, 1000, VIEW, ROW, 10)).toEqual({ start: 980, end: 1000 });
  expect(rangeOf(0, 0, VIEW, ROW)).toEqual({ start: 0, end: 0 });
});

test("wheel deltas convert per DOM_DELTA mode", () => {
  expect(wheelRows(100, 0, ROW, VIEW)).toBeCloseTo(100 / 29);
  expect(wheelRows(3, 1, ROW, VIEW)).toBe(3);
  expect(wheelRows(1, 2, ROW, VIEW)).toBe(20);
});

test("align: auto only moves when off-screen, center puts the row mid-viewport", () => {
  expect(alignRow(10, 0, 1000, VIEW, ROW, "auto")).toBe(0); // already visible
  expect(alignRow(25, 0, 1000, VIEW, ROW, "auto")).toBe(6); // just below → scroll minimally
  expect(alignRow(5, 20, 1000, VIEW, ROW, "auto")).toBe(5); // above → to the top edge
  expect(alignRow(500, 0, 1000, VIEW, ROW, "center")).toBe(490.5);
  expect(alignRow(999, 0, 1000, VIEW, ROW, "center")).toBe(980); // clamped at the end
});

test("thumb geometry: hidden when it all fits, min height on huge files, ends flush", () => {
  expect(thumbOf(0, 10, VIEW, ROW, 580)).toBeNull();
  const big = thumbOf(0, 1_578_837, VIEW, ROW, 580);
  expect(big).toEqual({ top: 0, height: 24 });
  const end = thumbOf(maxRow(1_578_837, VIEW, ROW), 1_578_837, VIEW, ROW, 580);
  expect(end).toEqual({ top: 556, height: 24 }); // 580 - 24, no gap at the bottom
});

test("marker map lines up with the thumb even at the minimum thumb height", () => {
  const total = 1_578_837;
  const track = VIEW;
  const thumbH = thumbOf(0, total, VIEW, ROW, track)!.height; // clamped to the 24px minimum
  const buckets = markBuckets(track, thumbH);
  // for scroll positions across the whole range, the bucket holding the middle
  // visible row must be painted within the thumb — otherwise aiming the thumb at
  // a marker misses the content it stands for
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    const row = maxRow(total, VIEW, ROW) * frac;
    const t = thumbOf(row, total, VIEW, ROW, track)!;
    const y = markOffset(thumbH) + bucketOfRow(row + 10, total, buckets);
    expect(y).toBeGreaterThanOrEqual(t.top);
    expect(y).toBeLessThanOrEqual(t.top + t.height);
    expect(Math.abs(y - (t.top + t.height / 2))).toBeLessThanOrEqual(1); // and near its centre
  }
});

test("a click on the track resolves to the bucket it points at", () => {
  const total = 1000;
  const buckets = markBuckets(600, 24);
  expect(bucketAtY(12, 24, buckets)).toBe(0); // top edge of the map
  expect(bucketAtY(0, 24, buckets)).toBe(0); // above it, clamped
  expect(bucketAtY(1e6, 24, buckets)).toBe(buckets - 1);
  expect(bucketOfRow(rowOfBucket(42, total, buckets), total, buckets)).toBe(42); // round-trip
});

test("track y maps back to a row, inverse of the thumb position", () => {
  const total = 1_578_837;
  const t = thumbOf(0, total, VIEW, ROW, 580)!;
  expect(rowAtY(0, 580, t.height, total, VIEW, ROW)).toBe(0);
  expect(rowAtY(580 - t.height, 580, t.height, total, VIEW, ROW)).toBe(maxRow(total, VIEW, ROW));
  expect(rowAtY(9999, 580, t.height, total, VIEW, ROW)).toBe(maxRow(total, VIEW, ROW));
});
