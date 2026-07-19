// Opt-in "check for updates": one GitHub API call at startup, compares the
// latest release tag to the running version. No auto-download — just a notice
// with a link to the releases page. Off by default (see Settings.checkForUpdates).

const RELEASES_API = "https://api.github.com/repos/bwaynesu/UnityLogViewer/releases/latest";
const RELEASES_PAGE = "https://github.com/bwaynesu/UnityLogViewer/releases/latest";

/** Numeric dot-compare, tolerant of a leading `v` and missing components. */
export function isNewer(latest: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Returns the newer release (version without `v`, plus a link) or null. Never throws. */
export async function checkForUpdate(
  current: string,
): Promise<{ version: string; url: string } | null> {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof data.tag_name === "string" ? data.tag_name : "";
    if (tag && isNewer(tag, current)) {
      const url = typeof data.html_url === "string" ? data.html_url : RELEASES_PAGE;
      return { version: tag.replace(/^v/i, ""), url };
    }
  } catch {
    // offline, rate-limited, or blocked — a courtesy check, so fail silent
  }
  return null;
}
