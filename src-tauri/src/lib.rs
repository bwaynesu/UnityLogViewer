mod paths;
mod query;

use query::{
    group, next_error as find_error, position_in, position_in_groups, top_error_groups,
    CompiledFilter, FilterParams,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use ulv_core::{parse_banner, parse_with_progress, Banner, Level, LogEntry};

struct Loaded {
    path: String,
    banner: Banner,
    entries: Vec<LogEntry>,
    /// Grouped (collapse) view cache: (filter key, [(first entry id, count)]).
    groups: Option<(String, Vec<(u32, u32)>)>,
    /// Local Unity project root (inferred at open or set by the user).
    project_root: Option<String>,
}

/// Multiple open files keyed by id (tabs).
#[derive(Default)]
struct Files {
    next_id: u32,
    map: HashMap<u32, Loaded>,
}

#[derive(Default)]
struct AppState(Mutex<Files>);

fn get<'a>(files: &'a Files, file_id: u32) -> Result<&'a Loaded, String> {
    files.map.get(&file_id).ok_or_else(|| "unknown file id".into())
}

/// Build (or reuse) the grouped view for this filter. Borrows the cache field
/// separately from `entries` so callers can keep reading entries alongside.
fn ensure_groups<'a>(
    entries: &[LogEntry],
    cache: &'a mut Option<(String, Vec<(u32, u32)>)>,
    key: &str,
    f: &CompiledFilter,
) -> &'a [(u32, u32)] {
    if cache.as_ref().map(|(k, _)| k != key).unwrap_or(true) {
        *cache = Some((key.to_string(), group(entries, f)));
    }
    &cache.as_ref().unwrap().1
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    path: String,
    total: usize,
    log: usize,
    warning: usize,
    error: usize,
    assert: usize,
    exception: usize,
    banner: Banner,
    /// Auto-inferred local project root, when the log came from this machine.
    project_root: Option<String>,
    /// Entry id of the native crash-dump marker, when present.
    crash_id: Option<u32>,
}

impl Stats {
    fn of(loaded: &Loaded) -> Stats {
        let mut counts = [0usize; 5];
        for e in &loaded.entries {
            counts[e.level as usize] += 1;
        }
        Stats {
            total: loaded.entries.len(),
            log: counts[Level::Log as usize],
            warning: counts[Level::Warning as usize],
            error: counts[Level::Error as usize],
            assert: counts[Level::Assert as usize],
            exception: counts[Level::Exception as usize],
            banner: loaded.banner.clone(),
            project_root: loaded.project_root.clone(),
            crash_id: loaded
                .entries
                .iter()
                .find(|e| e.message.starts_with(ulv_core::CRASH_MARKER))
                .map(|e| e.id),
            path: loaded.path.clone(),
        }
    }
}

#[derive(Serialize)]
struct Row {
    entry: LogEntry,
    /// Present in the grouped (collapse) view.
    count: Option<u32>,
}

#[derive(Serialize)]
struct Page {
    total: usize,
    offset: usize,
    items: Vec<Row>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    file_id: u32,
    stats: Stats,
}

#[tauri::command]
async fn open_file(path: String, app: AppHandle, state: State<'_, AppState>) -> Result<Opened, String> {
    let read_path = path.clone();
    // parse off the UI thread; invalid UTF-8 replaced, never fatal
    let (entries, banner) = tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&read_path).map_err(|e| format!("{read_path}: {e}"))?;
        let text = String::from_utf8_lossy(&bytes);
        let total = text.len().max(1);
        let mut last_pct = 0usize;
        let entries = parse_with_progress(&text, |done| {
            let pct = (done * 100 / total).min(100);
            if pct > last_pct {
                last_pct = pct;
                let _ = app.emit("parse-progress", pct);
            }
        });
        Ok::<_, String>((entries, parse_banner(&text)))
    })
    .await
    .map_err(|e| e.to_string())??;

    let project_root = paths::infer_root(
        entries
            .iter()
            .flat_map(|e| e.frames.iter())
            .filter_map(|f| f.file.as_deref()),
    );
    let loaded = Loaded { path, banner, entries, groups: None, project_root };
    let stats = Stats::of(&loaded);
    let mut files = state.0.lock().unwrap();
    files.next_id += 1;
    let file_id = files.next_id;
    files.map.insert(file_id, loaded);
    Ok(Opened { file_id, stats })
}

#[tauri::command]
fn close_file(file_id: u32, state: State<'_, AppState>) {
    state.0.lock().unwrap().map.remove(&file_id);
}

/// Detected Player.log files under LocalLow.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalLog {
    game: String,
    path: String,
    size: u64,
    modified_ms: u64,
}

#[tauri::command]
fn scan_local_logs() -> Vec<LocalLog> {
    let Ok(profile) = std::env::var("USERPROFILE") else {
        return Vec::new(); // Windows-only scan; macOS/Linux paths when we ship there
    };
    let base = std::path::Path::new(&profile).join("AppData/LocalLow");
    let mut out = Vec::new();
    for company in std::fs::read_dir(base).into_iter().flatten().flatten() {
        for product in std::fs::read_dir(company.path()).into_iter().flatten().flatten() {
            for name in ["Player.log", "Player-prev.log"] {
                let p = product.path().join(name);
                let Ok(meta) = p.metadata() else { continue };
                out.push(LocalLog {
                    game: format!(
                        "{}/{}",
                        company.file_name().to_string_lossy(),
                        product.file_name().to_string_lossy()
                    ),
                    path: p.to_string_lossy().into_owned(),
                    size: meta.len(),
                    modified_ms: meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0),
                });
            }
        }
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out
}

/// Scan user-chosen folders for *.log files, `depth` subfolder levels deep.
/// (Logs delivered into a drop folder, not produced under LocalLow.)
#[tauri::command]
fn scan_watched(folders: Vec<String>, depth: u32) -> Vec<LocalLog> {
    let mut out = Vec::new();
    for folder in &folders {
        let base = std::path::Path::new(folder);
        let base_name = base
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| folder.clone());
        let mut files = Vec::new();
        paths::collect_logs(base, depth.min(5), 300, &mut files);
        for p in files {
            let Ok(meta) = p.metadata() else { continue };
            let rel = p
                .parent()
                .and_then(|par| par.strip_prefix(base).ok())
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            out.push(LocalLog {
                game: if rel.is_empty() { base_name.clone() } else { format!("{base_name}/{rel}") },
                path: p.to_string_lossy().into_owned(),
                size: meta.len(),
                modified_ms: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
            });
        }
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out.truncate(300);
    out
}

/// Flat filtered page. Full scan per call (~ms at 300k entries in
/// release); cache a filtered id index if scrolling ever stutters on huge files.
#[tauri::command]
fn get_entries(
    file_id: u32,
    filter: FilterParams,
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Page, String> {
    let f = filter.compile()?;
    let files = state.0.lock().unwrap();
    let loaded = get(&files, file_id)?;
    let mut total = 0usize;
    let mut items = Vec::new();
    let limit = limit.min(1000);
    for e in loaded.entries.iter().filter(|e| f.matches(e)) {
        if total >= offset && items.len() < limit {
            items.push(Row { entry: e.clone(), count: None });
        }
        total += 1;
    }
    Ok(Page { total, offset, items })
}

/// Grouped (collapse) page over the same filter.
#[tauri::command]
fn get_groups(
    file_id: u32,
    filter: FilterParams,
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Page, String> {
    let f = filter.compile()?;
    let key = filter.key();
    let mut files = state.0.lock().unwrap();
    let loaded = files.map.get_mut(&file_id).ok_or("unknown file id")?;
    let groups = ensure_groups(&loaded.entries, &mut loaded.groups, &key, &f);
    let items = groups
        .iter()
        .skip(offset)
        .take(limit.min(1000))
        .map(|&(id, count)| Row { entry: loaded.entries[id as usize].clone(), count: Some(count) })
        .collect();
    Ok(Page { total: groups.len(), offset, items })
}

/// Entry ids of every occurrence in the collapse group containing entry `id`
/// (capped; expand). Keyed by id, not hash — u64 hashes lose precision in JS.
#[tauri::command]
fn get_occurrences(
    file_id: u32,
    filter: FilterParams,
    id: u32,
    state: State<'_, AppState>,
) -> Result<Vec<u32>, String> {
    let f = filter.compile()?;
    let files = state.0.lock().unwrap();
    let loaded = get(&files, file_id)?;
    let hash = loaded.entries.get(id as usize).ok_or("unknown entry id")?.hash;
    Ok(loaded
        .entries
        .iter()
        .filter(|e| e.hash == hash && f.matches(e))
        .map(|e| e.id)
        .take(1000)
        .collect())
}

#[derive(Serialize)]
struct FilterPosition {
    index: usize,
    matches: bool,
}

/// Where does entry `id` land in the active view (flat list, or its collapse
/// group when `collapse`)? Anchors selection on filter changes and
/// occurrence jumps.
#[tauri::command]
fn position_of(
    file_id: u32,
    filter: FilterParams,
    id: u32,
    collapse: bool,
    state: State<'_, AppState>,
) -> Result<FilterPosition, String> {
    let f = filter.compile()?;
    let key = filter.key();
    let mut files = state.0.lock().unwrap();
    let loaded = files.map.get_mut(&file_id).ok_or("unknown file id")?;
    let (index, matches) = if collapse {
        let groups = ensure_groups(&loaded.entries, &mut loaded.groups, &key, &f);
        position_in_groups(&loaded.entries, groups, id)
    } else {
        position_in(&loaded.entries, &f, id)
    };
    Ok(FilterPosition { index, matches })
}

/// Next/previous error-ish row for F8 navigation, in the active view.
#[tauri::command]
fn next_error(
    file_id: u32,
    filter: FilterParams,
    collapse: bool,
    from: i64,
    backwards: bool,
    state: State<'_, AppState>,
) -> Result<Option<usize>, String> {
    let f = filter.compile()?;
    let key = filter.key();
    let mut files = state.0.lock().unwrap();
    let loaded = files.map.get_mut(&file_id).ok_or("unknown file id")?;
    let groups = if collapse {
        Some(ensure_groups(&loaded.entries, &mut loaded.groups, &key, &f))
    } else {
        None
    };
    Ok(find_error(&loaded.entries, &f, groups, from, backwards))
}

/// Top repeated errors over the whole file for the summary panel.
#[tauri::command]
fn top_errors(file_id: u32, limit: usize, state: State<'_, AppState>) -> Result<Vec<Row>, String> {
    let files = state.0.lock().unwrap();
    let loaded = get(&files, file_id)?;
    Ok(top_error_groups(&loaded.entries, limit.min(50))
        .into_iter()
        .map(|(id, count)| Row {
            entry: loaded.entries[id as usize].clone(),
            count: Some(count),
        })
        .collect())
}

/// File paths passed on this process's command line (`ulv <path>`).
/// The frontend fetches these once on mount.
#[tauri::command]
fn startup_paths() -> Vec<String> {
    cli_file_args(std::env::args().skip(1))
}

fn cli_file_args(args: impl Iterator<Item = String>) -> Vec<String> {
    args.filter(|a| !a.starts_with('-') && std::path::Path::new(a).is_file())
        .collect()
}

/// ProgID used for the `.log` file association.
#[cfg(target_os = "windows")]
const LOG_PROGID: &str = "UnityLogViewer.log";

/// CREATE_NO_WINDOW: console helpers (reg/tasklist/vswhere) spawned from this
/// GUI app would otherwise each flash a cmd window. This flag suppresses it.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Run a console program capturing stdout, with no flashing window.
#[cfg(target_os = "windows")]
fn hidden_output(program: &str, args: &[&str]) -> Option<std::process::Output> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
}

/// Run `reg` and return stdout on success.
#[cfg(target_os = "windows")]
fn reg_run(args: &[&str]) -> Option<String> {
    let out = hidden_output("reg", args)?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Windows' Explorer `UserChoice` for `.log` overrides HKCU\Software\Classes.
/// It's hash-protected — we can read it but cannot write it programmatically.
#[cfg(target_os = "windows")]
const USERCHOICE_KEY: &str =
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.log\UserChoice";

#[cfg(target_os = "windows")]
fn user_choice_progid() -> Option<String> {
    reg_run(&["query", USERCHOICE_KEY, "/v", "ProgId"]).and_then(|o| paths::reg_sz_value(&o))
}

#[cfg(target_os = "windows")]
fn classes_progid() -> Option<String> {
    reg_run(&["query", r"HKCU\Software\Classes\.log", "/ve"]).and_then(|o| paths::reg_sz_value(&o))
}

/// Is our `.log` registration in place? Reflects what the toggle controls (our
/// Classes ProgID), NOT the effective default — Windows' UserChoice can shadow
/// it but we can't write UserChoice, so tying the checkbox to it would make it
/// impossible to tick/untick. The shadowing is surfaced as a note instead.
/// Registry is the source of truth — deliberately NOT a persisted setting.
#[tauri::command]
fn log_association() -> bool {
    #[cfg(target_os = "windows")]
    {
        classes_progid().as_deref() == Some(LOG_PROGID)
    }
    #[cfg(not(target_os = "windows"))]
    false
}

/// Toggle the `.log` association (HKCU, no admin). Enabling backs up any
/// previous Classes association under our ProgID; disabling restores it.
/// Returns "" on a clean success, or a short note the UI shows to the user
/// (e.g. Windows is still forcing a different default via UserChoice).
#[tauri::command]
fn set_log_association(enable: bool) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let classes = r"HKCU\Software\Classes";
        let ext = format!(r"{classes}\.log");
        let progid = format!(r"{classes}\{LOG_PROGID}");
        let current = classes_progid();
        let err = |what: &str| format!("registry write failed ({what})");
        if enable {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let cmd = open_command(&exe.display().to_string());
            reg_run(&["add", &format!(r"{progid}\shell\open\command"), "/ve", "/d", &cmd, "/f"])
                .ok_or_else(|| err("command"))?;
            reg_run(&["add", &progid, "/ve", "/d", "Unity log file", "/f"])
                .ok_or_else(|| err("progid"))?;
            if let Some(prev) = current.filter(|c| c != LOG_PROGID) {
                reg_run(&["add", &progid, "/v", "backup", "/d", &prev, "/f"])
                    .ok_or_else(|| err("backup"))?;
            }
            reg_run(&["add", &ext, "/ve", "/d", LOG_PROGID, "/f"]).ok_or_else(|| err(".log"))?;
            // Windows shields the real default (UserChoice) behind a hash we can't
            // forge; if one points elsewhere, our Classes entry is shadowed.
            if user_choice_progid().filter(|uc| uc != LOG_PROGID).is_some() {
                return Ok("Registered. Windows still has a different default for .log — \
                    right-click a .log → Open with → Choose another app → tick \
                    \u{201c}Always\u{201d} and pick Unity Log Viewer once to finish."
                    .into());
            }
            Ok(String::new())
        } else {
            if current.as_deref() == Some(LOG_PROGID) {
                let backup =
                    reg_run(&["query", &progid, "/v", "backup"]).and_then(|o| paths::reg_sz_value(&o));
                match backup {
                    Some(prev) => {
                        reg_run(&["add", &ext, "/ve", "/d", &prev, "/f"])
                            .ok_or_else(|| err("restore"))?;
                    }
                    None => {
                        let _ = reg_run(&["delete", &ext, "/ve", "/f"]);
                    }
                }
            }
            let _ = reg_run(&["delete", &progid, "/f"]);
            Ok(String::new())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enable;
        Err("File association is only supported on Windows".into())
    }
}

/// The `shell\open\command` value that makes double-clicking a `.log` launch us:
/// `"<exe path>" "%1"`. Shared by enable and the startup self-heal so both build
/// a byte-identical string (the heal compares the stored value against this).
#[cfg(target_os = "windows")]
fn open_command(exe: &str) -> String {
    format!("\"{exe}\" \"%1\"")
}

/// Repair the `.log` association when the executable has moved or been renamed.
/// Portable builds carry the version in their filename, so every update is a
/// different file; installed builds can also move if the install path changes.
/// If our ProgID is still the Classes default, rewrite its open-command to the
/// *current* exe. Touches only the entry we own (never UserChoice, never a
/// foreign default) and writes only when it actually differs, so it's a cheap
/// no-op on a normal launch. The one gap it can't cover — double-clicking a
/// renamed portable *before* ever launching the new exe — self-corrects the
/// first time the new exe runs.
#[cfg(target_os = "windows")]
fn heal_log_association() {
    if classes_progid().as_deref() != Some(LOG_PROGID) {
        return; // association isn't ours (or absent) — nothing to repair
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let desired = open_command(&exe.display().to_string());
    let key = format!(r"HKCU\Software\Classes\{LOG_PROGID}\shell\open\command");
    let current = reg_run(&["query", &key, "/ve"]).and_then(|o| paths::reg_sz_value(&o));
    if current.as_deref() != Some(desired.as_str()) {
        let _ = reg_run(&["add", &key, "/ve", "/d", &desired, "/f"]);
    }
}

/// Is this directory a Unity project root? (stateless check for the picker)
#[tauri::command]
fn validate_root(path: String) -> bool {
    paths::is_unity_root(std::path::Path::new(&path))
}

/// Map a frame path to an existing local file; None = degrade when unmappable.
/// `fallback_root` is the frontend's session-cached manual root.
#[tauri::command]
fn resolve_path(
    file_id: u32,
    file: String,
    fallback_root: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let files = state.0.lock().unwrap();
    let loaded = get(&files, file_id)?;
    let root = loaded.project_root.as_deref().or(fallback_root.as_deref());
    Ok(paths::resolve_local(root, &file).map(|p| p.to_string_lossy().into_owned()))
}

/// Locate devenv.exe via vswhere (official Visual Studio locator). Cached.
#[cfg(target_os = "windows")]
fn devenv_path() -> Option<&'static str> {
    use std::sync::OnceLock;
    static DEVENV: OnceLock<Option<String>> = OnceLock::new();
    DEVENV
        .get_or_init(|| {
            let vswhere =
                r"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe";
            let out = hidden_output(vswhere, &["-latest", "-property", "productPath"])?;
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            std::path::Path::new(&path).is_file().then_some(path)
        })
        .as_deref()
}

#[cfg(target_os = "windows")]
fn process_running(image: &str) -> bool {
    hidden_output("tasklist", &["/FI", &format!("IMAGENAME eq {image}"), "/NH"])
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(&image.to_lowercase()))
        .unwrap_or(false)
}

/// Unity stores the user's External Script Editor choice in the registry
/// (kScriptsDefaultApp). Reading it is the truest emulation of Unity's
/// console-click behavior: same machine, same editor.
#[cfg(target_os = "windows")]
fn unity_script_editor() -> Option<&'static str> {
    use std::sync::OnceLock;
    static EDITOR: OnceLock<Option<String>> = OnceLock::new();
    EDITOR
        .get_or_init(|| {
            // The whole Unity-prefs key is large (~1s to enumerate); primed on a
            // background thread at startup so the first IDE click doesn't wait.
            let stdout = reg_run(&["query", r"HKCU\Software\Unity Technologies\Unity Editor 5.x"])?;
            for line in stdout.lines() {
                if !line.contains("kScriptsDefaultApp") {
                    continue;
                }
                let toks: Vec<&str> = line.split_whitespace().collect();
                let decoded = match toks.as_slice() {
                    [_, "REG_BINARY", hex] => paths::decode_reg_hex(hex),
                    [_, "REG_SZ", rest @ ..] => Some(rest.join(" ")),
                    _ => None,
                };
                if let Some(p) = decoded {
                    if p.to_lowercase().ends_with(".exe") && std::path::Path::new(&p).is_file() {
                        return Some(p);
                    }
                }
            }
            None
        })
        .as_deref()
}

/// Open a stack-frame target with zero configuration. Ladder:
/// 1. custom template, when the user set one (advanced escape hatch)
/// 2. Unity's own External Script Editor (registry) — dispatch file/line args
///    per editor family (devenv/rider/code/sublime), exactly what Unity would do
/// 3. .sln in project root + Visual Studio via vswhere (no Unity installed)
/// 4. .sln but no Visual Studio: shell-open the .sln (whatever IDE owns it)
/// 5. no .sln: shell-open the file with the system default editor
/// Returns the strategy used, for the frontend notice.
#[tauri::command]
fn open_in_ide(
    file_id: u32,
    template: String,
    path: String,
    line: u32,
    fallback_root: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if !template.trim().is_empty() {
        let cmd = paths::build_cmdline(&template, &path, line);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            std::process::Command::new("cmd")
                // raw_arg: keep the template's own quoting intact (cmd /C strips
                // re-quoted strings — this was why launches silently failed)
                .raw_arg(format!("/C {cmd}"))
                .creation_flags(0x0800_0000)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(target_os = "windows"))]
        std::process::Command::new("sh")
            .args(["-c", &cmd])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok("custom".into());
    }

    let root = {
        let files = state.0.lock().unwrap();
        let loaded = get(&files, file_id)?;
        loaded.project_root.clone().or(fallback_root)
    };
    let sln = root.as_deref().and_then(paths::find_sln);
    let sln_str = sln.as_ref().map(|p| p.to_string_lossy().into_owned());

    #[cfg(target_os = "windows")]
    if let Some(editor) = unity_script_editor() {
        let kind = paths::editor_kind(editor);
        let image = std::path::Path::new(editor)
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default();
        let running = kind == paths::EditorKind::Devenv && process_running(&image);
        let args = paths::editor_args(kind, sln_str.as_deref(), root.as_deref(), &path, line, running);
        std::process::Command::new(editor)
            .args(&args)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(format!("unity-editor-pref:{kind:?}"));
    }

    #[cfg(target_os = "windows")]
    if let Some(sln) = &sln {
        if let Some(devenv) = devenv_path() {
            let running = process_running("devenv.exe");
            let args = paths::editor_args(
                paths::EditorKind::Devenv,
                sln_str.as_deref(),
                root.as_deref(),
                &path,
                line,
                running,
            );
            std::process::Command::new(devenv)
                .args(&args)
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok("devenv".into());
        }
        // no VS → hand the sln to its registered IDE (line is lost);
        // add Rider/VS Code CLI detection here if users ask for it
        tauri_plugin_opener::open_path(sln, None::<&str>).map_err(|e| e.to_string())?;
        tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
        return Ok("sln".into());
    }

    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
    Ok("default".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Warm the IDE-locator caches off the UI path: the Unity-prefs reg query is
    // ~1s, so priming it now keeps the first "open in IDE" click snappy. Also
    // repair the .log association here in case this exe was renamed/moved since
    // it was enabled (portable builds are versioned in their filename).
    #[cfg(target_os = "windows")]
    std::thread::spawn(|| {
        let _ = unity_script_editor();
        let _ = devenv_path();
        heal_log_association();
    });

    tauri::Builder::default()
        // registered first so a second `ulv <path>` launch reaches the running
        // instance: focus the window and forward its file args
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            let _ = app.emit("cli-open", cli_file_args(argv.into_iter().skip(1)));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_file,
            close_file,
            scan_local_logs,
            scan_watched,
            get_entries,
            get_groups,
            get_occurrences,
            position_of,
            next_error,
            top_errors,
            startup_paths,
            log_association,
            set_log_association,
            validate_root,
            resolve_path,
            open_in_ide
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, target_os = "windows"))]
mod assoc_tests {
    use super::open_command;

    #[test]
    fn open_command_quotes_exe_and_placeholder() {
        assert_eq!(open_command(r"C:\a\App.exe"), "\"C:\\a\\App.exe\" \"%1\"");
    }

    #[test]
    fn heal_rewrites_only_when_the_exe_path_changed() {
        // A versioned portable stored one path; the running exe is a different
        // file → the stored command differs, so the self-heal must rewrite.
        let stored = open_command(r"C:\old\UnityLogViewer_1.1.0_x64_portable.exe");
        let current = open_command(r"C:\new\UnityLogViewer_1.2.0_x64_portable.exe");
        assert_ne!(stored, current);
        // Same path on a normal relaunch → identical → no write (cheap no-op).
        assert_eq!(current, open_command(r"C:\new\UnityLogViewer_1.2.0_x64_portable.exe"));
    }
}
