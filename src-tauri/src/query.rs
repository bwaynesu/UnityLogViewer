//! Filter compilation and query operations shared by the IPC commands.

use regex::{escape, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use ulv_core::{Level, LogEntry};

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FilterParams {
    pub levels: Vec<Level>,
    #[serde(default)]
    pub includes: Vec<String>,
    #[serde(default)]
    pub excludes: Vec<String>,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
}

impl FilterParams {
    pub fn compile(&self) -> Result<CompiledFilter, String> {
        let build = |pat: &String| -> Result<Regex, String> {
            let source = if self.regex { pat.clone() } else { escape(pat) };
            RegexBuilder::new(&source)
                .case_insensitive(!self.case_sensitive)
                .build()
                .map_err(|e| e.to_string())
        };
        Ok(CompiledFilter {
            levels: self.levels.clone(),
            includes: self.includes.iter().map(build).collect::<Result<_, _>>()?,
            excludes: self.excludes.iter().map(build).collect::<Result<_, _>>()?,
        })
    }

    /// Cache key for the grouped view.
    pub fn key(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

pub struct CompiledFilter {
    levels: Vec<Level>,
    includes: Vec<Regex>,
    excludes: Vec<Regex>,
}

impl CompiledFilter {
    pub fn matches(&self, e: &LogEntry) -> bool {
        self.levels.contains(&e.level)
            && self.includes.iter().all(|r| hit(r, e))
            && !self.excludes.iter().any(|r| hit(r, e))
    }
}

/// Search covers the message and every stack frame (function names matter).
fn hit(r: &Regex, e: &LogEntry) -> bool {
    r.is_match(&e.message) || e.frames.iter().any(|f| r.is_match(&f.raw))
}

/// Collapse: (first entry id, occurrence count) per hash, in first-occurrence order.
pub fn group(entries: &[LogEntry], f: &CompiledFilter) -> Vec<(u32, u32)> {
    let mut order: Vec<(u32, u32)> = Vec::new();
    let mut by_hash: std::collections::HashMap<u64, usize> = std::collections::HashMap::new();
    for e in entries.iter().filter(|e| f.matches(e)) {
        match by_hash.get(&e.hash) {
            Some(&i) => order[i].1 += 1,
            None => {
                by_hash.insert(e.hash, order.len());
                order.push((e.id, 1));
            }
        }
    }
    order
}

fn is_error(l: Level) -> bool {
    matches!(l, Level::Error | Level::Assert | Level::Exception)
}

/// Top repeated error groups over the WHOLE file (filter-independent — the
/// summary answers "what is wrong with this log", not "with this view").
/// Sorted by occurrence count desc, then first appearance.
pub fn top_error_groups(entries: &[LogEntry], limit: usize) -> Vec<(u32, u32)> {
    let mut order: Vec<(u32, u32)> = Vec::new();
    let mut by_hash: std::collections::HashMap<u64, usize> = std::collections::HashMap::new();
    for e in entries.iter().filter(|e| is_error(e.level)) {
        match by_hash.get(&e.hash) {
            Some(&i) => order[i].1 += 1,
            None => {
                by_hash.insert(e.hash, order.len());
                order.push((e.id, 1));
            }
        }
    }
    order.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    order.truncate(limit);
    order
}

/// Position of entry `id`'s collapse group in the grouped list: the group's own
/// index when present, otherwise the insertion point by first-occurrence order.
pub fn position_in_groups(entries: &[LogEntry], groups: &[(u32, u32)], id: u32) -> (usize, bool) {
    let Some(target) = entries.get(id as usize) else {
        return (0, false);
    };
    for (i, &(gid, _)) in groups.iter().enumerate() {
        if entries[gid as usize].hash == target.hash {
            return (i, true);
        }
    }
    (groups.iter().filter(|&&(gid, _)| gid < id).count(), false)
}

/// Position of entry `id` in the filtered flat list: its own index when it
/// matches, otherwise the insertion point of the nearest following match.
pub fn position_in(entries: &[LogEntry], f: &CompiledFilter, id: u32) -> (usize, bool) {
    let mut index = 0;
    for e in entries {
        let m = f.matches(e);
        if e.id == id {
            return (index, m);
        }
        if m {
            index += 1;
        }
    }
    (index, false)
}

/// Index of the next/previous error-ish row relative to `from` (exclusive), in the
/// current view: the flat filtered list, or the grouped list when provided.
pub fn next_error(
    entries: &[LogEntry],
    f: &CompiledFilter,
    groups: Option<&[(u32, u32)]>,
    from: i64,
    backwards: bool,
) -> Option<usize> {
    let hits: Vec<usize> = match groups {
        Some(gs) => gs
            .iter()
            .enumerate()
            .filter(|(_, (id, _))| is_error(entries[*id as usize].level))
            .map(|(i, _)| i)
            .collect(),
        None => entries
            .iter()
            .filter(|e| f.matches(e))
            .enumerate()
            .filter(|(_, e)| is_error(e.level))
            .map(|(i, _)| i)
            .collect(),
    };
    if backwards {
        hits.iter().rev().find(|&&i| (i as i64) < from).copied()
    } else {
        hits.iter().find(|&&i| (i as i64) > from).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ulv_core::parse;

    fn params(levels: Vec<Level>) -> FilterParams {
        FilterParams { levels, includes: vec![], excludes: vec![], regex: false, case_sensitive: false }
    }

    const ALL: [Level; 5] =
        [Level::Log, Level::Warning, Level::Error, Level::Assert, Level::Exception];

    fn sample() -> Vec<LogEntry> {
        parse(
            "Alpha spawned\n\nbad thing\nUnityEngine.Debug:LogError(Object)\n\n\
             alpha died\n\nCamera ready\nCameraManager:Register(CameraController)\n",
        )
    }

    #[test]
    fn include_is_case_insensitive_by_default() {
        let mut p = params(ALL.to_vec());
        p.includes = vec!["alpha".into()];
        let f = p.compile().unwrap();
        let hits: Vec<_> = sample().iter().filter(|e| f.matches(e)).map(|e| e.id).collect();
        assert_eq!(hits, vec![0, 2]);
        p.case_sensitive = true;
        let f = p.compile().unwrap();
        let hits: Vec<_> = sample().iter().filter(|e| f.matches(e)).map(|e| e.id).collect();
        assert_eq!(hits, vec![2]);
    }

    #[test]
    fn exclude_removes_matches() {
        let mut p = params(ALL.to_vec());
        p.includes = vec!["alpha".into()];
        p.excludes = vec!["died".into()];
        let f = p.compile().unwrap();
        let hits: Vec<_> = sample().iter().filter(|e| f.matches(e)).map(|e| e.id).collect();
        assert_eq!(hits, vec![0]);
    }

    #[test]
    fn search_covers_stack_frames() {
        let mut p = params(ALL.to_vec());
        p.includes = vec!["CameraManager".into()];
        let f = p.compile().unwrap();
        let hits: Vec<_> = sample().iter().filter(|e| f.matches(e)).map(|e| e.id).collect();
        assert_eq!(hits, vec![3]);
    }

    #[test]
    fn plain_mode_escapes_regex_chars_and_regex_mode_errors_are_reported() {
        let mut p = params(ALL.to_vec());
        p.includes = vec!["a(".into()];
        assert!(p.compile().is_ok(), "plain mode must escape metacharacters");
        p.regex = true;
        assert!(p.compile().is_err(), "invalid regex must surface an error");
    }

    #[test]
    fn group_counts_and_orders_by_first_occurrence() {
        let entries = parse("same\n\nother\n\nsame\n\nsame\n");
        let f = params(ALL.to_vec()).compile().unwrap();
        let g = group(&entries, &f);
        assert_eq!(g.len(), 2);
        assert_eq!(g[0], (0, 3)); // "same" first at id 0, 3 occurrences
        assert_eq!(g[1], (1, 1));
    }

    #[test]
    fn top_error_groups_sorted_by_count() {
        let entries = parse(
            "boom A\nUnityEngine.Debug:LogError(Object)\n\n\
             boom B\nUnityEngine.Debug:LogError(Object)\n\n\
             boom B\nUnityEngine.Debug:LogError(Object)\n\n\
             just a log line\n",
        );
        let top = top_error_groups(&entries, 10);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0], (1, 2)); // "boom B" ×2 first
        assert_eq!(top[1], (0, 1));
        assert_eq!(top_error_groups(&entries, 1).len(), 1);
    }

    #[test]
    fn next_error_walks_filtered_list_both_ways() {
        let entries = sample(); // errors at filtered index 1 only
        let f = params(ALL.to_vec()).compile().unwrap();
        assert_eq!(next_error(&entries, &f, None, -1, false), Some(1));
        assert_eq!(next_error(&entries, &f, None, 1, false), None);
        assert_eq!(next_error(&entries, &f, None, 3, true), Some(1));
    }

    #[test]
    fn position_in_matching_and_filtered_out() {
        let entries = sample(); // ids 0..3, error at id 1
        let f = params(vec![Level::Error]).compile().unwrap();
        assert_eq!(position_in(&entries, &f, 1), (0, true));
        // id 2 (Log) is filtered out; one match (id 1) precedes it
        assert_eq!(position_in(&entries, &f, 2), (1, false));
    }

    #[test]
    fn position_in_groups_by_hash_and_insertion_point() {
        let entries = parse("same\n\nother\n\nsame\n");
        let f = params(ALL.to_vec()).compile().unwrap();
        let g = group(&entries, &f); // [("same" id0 ×2), ("other" id1 ×1)]
        // id 2 is a "same" occurrence → its group is index 0
        assert_eq!(position_in_groups(&entries, &g, 2), (0, true));
        // filtered-out entry: Error-only filter gives empty groups → insertion at 0
        let f_err = params(vec![Level::Error]).compile().unwrap();
        let g_err = group(&entries, &f_err);
        assert_eq!(position_in_groups(&entries, &g_err, 1), (0, false));
    }

    #[test]
    fn next_error_in_grouped_view() {
        let entries = sample();
        let f = params(ALL.to_vec()).compile().unwrap();
        let g = group(&entries, &f);
        let err_group = next_error(&entries, &f, Some(&g), -1, false).unwrap();
        assert_eq!(entries[g[err_group].0 as usize].message, "bad thing");
    }
}
