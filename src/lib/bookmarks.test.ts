import { expect, test } from "vitest";
import { toggleBookmark, type Bookmark } from "./bookmarks";

const bm = (id: number): Bookmark => ({ id, level: "Error", text: `e${id}` });

test("toggleBookmark adds sorted by id and removes on re-toggle", () => {
  let list = toggleBookmark([], bm(5));
  list = toggleBookmark(list, bm(2));
  expect(list.map((b) => b.id)).toEqual([2, 5]);
  list = toggleBookmark(list, bm(5));
  expect(list.map((b) => b.id)).toEqual([2]);
});
