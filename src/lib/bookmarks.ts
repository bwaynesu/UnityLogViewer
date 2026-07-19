import type { Row } from "./api";

/**
 * A bookmarked entry, snapshotted at toggle time so the sidebar list needs no
 * IPC round-trip. Session-only, per file.
 * ponytail: no persistence — Player.log is rewritten every run, so stored
 * bookmarks would usually point into a different file; persist (path + id)
 * if anyone asks.
 */
export interface Bookmark {
  id: number;
  level: Row["entry"]["level"];
  text: string; // first line of the message
}

/** Add if absent, remove if present; keeps the list sorted by entry id. */
export function toggleBookmark(list: Bookmark[], mark: Bookmark): Bookmark[] {
  if (list.some((b) => b.id === mark.id)) return list.filter((b) => b.id !== mark.id);
  return [...list, mark].sort((a, b) => a.id - b.id);
}
