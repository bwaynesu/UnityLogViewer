//! Unity project root inference and stack-frame path mapping.

use std::path::{Path, PathBuf};

/// Extract the `Assets/...` tail from a frame path, normalized to forward
/// slashes. Works for absolute build-machine paths and bare `Assets/...` paths.
pub fn extract_assets_rel(file: &str) -> Option<String> {
    let norm = file.replace('\\', "/");
    let lower = norm.to_lowercase();
    let idx = if lower.starts_with("assets/") {
        0
    } else {
        lower.find("/assets/")? + 1
    };
    Some(norm[idx..].to_string())
}

/// The prefix before `Assets/` in an absolute frame path (candidate project root).
fn root_prefix(file: &str) -> Option<String> {
    let norm = file.replace('\\', "/");
    let idx = norm.to_lowercase().find("/assets/")?;
    Some(norm[..idx].to_string())
}

/// A directory is a Unity project root if it has Assets/ and the reliable marker
/// ProjectSettings/ProjectVersion.txt.
pub fn is_unity_root(dir: &Path) -> bool {
    dir.join("Assets").is_dir() && dir.join("ProjectSettings/ProjectVersion.txt").is_file()
}

/// Scan frame file paths for a prefix that is a valid local Unity project root.
/// Zero-config case: the log was produced by a build/editor on this machine.
pub fn infer_root<'a>(files: impl Iterator<Item = &'a str>) -> Option<String> {
    let mut seen: Option<String> = None;
    for f in files {
        let Some(prefix) = root_prefix(f) else { continue };
        if seen.as_deref() == Some(prefix.as_str()) {
            continue; // already rejected or accepted identical prefix
        }
        if is_unity_root(Path::new(&prefix)) {
            return Some(prefix);
        }
        seen = Some(prefix);
    }
    None
}

/// Map a frame path to an existing local file: as-is when it already exists,
/// otherwise re-rooted under the project root (CI build-machine paths).
pub fn resolve_local(root: Option<&str>, file: &str) -> Option<PathBuf> {
    let p = Path::new(file);
    if p.is_absolute() && p.is_file() {
        return Some(p.to_path_buf());
    }
    let joined = Path::new(root?).join(extract_assets_rel(file)?);
    joined.is_file().then_some(joined)
}

/// Fill an IDE launch template. The template carries its own quoting.
pub fn build_cmdline(template: &str, path: &str, line: u32) -> String {
    template
        .replace("{path}", path)
        .replace("{line}", &line.to_string())
}

/// Editor families we know how to pass file/line arguments to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorKind {
    Devenv,
    Rider,
    Code,
    Sublime,
    Other,
}

pub fn editor_kind(exe: &str) -> EditorKind {
    let stem = Path::new(exe)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match stem.as_str() {
        "devenv" => EditorKind::Devenv,
        "rider64" | "rider" => EditorKind::Rider,
        "code" => EditorKind::Code,
        "sublime_text" | "subl" => EditorKind::Sublime,
        _ => EditorKind::Other,
    }
}

/// Arguments to launch `kind` at path:line, mirroring what Unity's own editor
/// integrations pass (VS: sln + Edit.GoTo; Rider: sln --line; VS Code: folder + -g).
pub fn editor_args(
    kind: EditorKind,
    sln: Option<&str>,
    root: Option<&str>,
    path: &str,
    line: u32,
    editor_running: bool,
) -> Vec<String> {
    let s = |v: &str| v.to_string();
    match kind {
        EditorKind::Devenv => {
            let goto = format!("Edit.GoTo {line}");
            match (editor_running, sln) {
                // attach to the running instance; don't re-open the solution
                (true, _) | (false, None) => vec![s("/Edit"), s(path), s("/Command"), goto],
                (false, Some(sln)) => vec![s(sln), s(path), s("/Command"), goto],
            }
        }
        EditorKind::Rider => {
            let mut a: Vec<String> = sln.map(s).into_iter().collect();
            a.extend([s("--line"), line.to_string(), s(path)]);
            a
        }
        EditorKind::Code => {
            let mut a: Vec<String> = root.map(s).into_iter().collect();
            a.extend([s("-g"), format!("{path}:{line}")]);
            a
        }
        EditorKind::Sublime => vec![format!("{path}:{line}")],
        EditorKind::Other => vec![s(path)],
    }
}

/// Decode a REG_BINARY hex dump that holds a UTF-8 string (Unity stores its
/// External Script Editor path this way), trimming the trailing NUL.
pub fn decode_reg_hex(hex: &str) -> Option<String> {
    let bytes: Option<Vec<u8>> = (0..hex.len() / 2 * 2)
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect();
    let mut bytes = bytes?;
    while bytes.last() == Some(&0) {
        bytes.pop();
    }
    String::from_utf8(bytes).ok()
}

/// Extract the REG_SZ data from `reg query` output. Matches on the "REG_SZ"
/// type token, not the value name — value names are localized ("(預設值)").
pub fn reg_sz_value(output: &str) -> Option<String> {
    for line in output.lines() {
        let mut toks = line.split_whitespace();
        if toks.any(|t| t == "REG_SZ") {
            let rest: Vec<&str> = toks.collect();
            if !rest.is_empty() {
                return Some(rest.join(" "));
            }
        }
    }
    None
}

/// Collect `*.log` files under `dir`, descending at most `depth` subdirectory
/// levels (0 = only files directly in `dir`). Capped so a folder like `D:\`
/// can't explode the scan.
pub fn collect_logs(dir: &Path, depth: u32, cap: usize, out: &mut Vec<PathBuf>) {
    if out.len() >= cap {
        return;
    }
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if out.len() >= cap {
            return;
        }
        let p = entry.path();
        if p.is_dir() {
            if depth > 0 {
                collect_logs(&p, depth - 1, cap, out);
            }
        } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("log")) {
            out.push(p);
        }
    }
}

/// First .sln in the project root (Unity generates one next to Assets/).
pub fn find_sln(root: &str) -> Option<PathBuf> {
    let mut slns: Vec<PathBuf> = std::fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("sln")))
        .collect();
    slns.sort();
    slns.into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assets_rel_from_ci_and_relative_paths() {
        assert_eq!(
            extract_assets_rel(r"C:\CICD\actions-runner\_work\MyGame\MyGame\Assets\Game\Script\Foo.cs").as_deref(),
            Some("Assets/Game/Script/Foo.cs")
        );
        assert_eq!(
            extract_assets_rel("Assets/Scripts/GameManager.cs").as_deref(),
            Some("Assets/Scripts/GameManager.cs")
        );
        assert_eq!(extract_assets_rel(r"D:\Elsewhere\NoMarker\Foo.cs"), None);
    }

    #[test]
    fn infer_and_resolve_against_a_real_root() {
        let dir = std::env::temp_dir().join("ulv-test-root");
        std::fs::remove_file(dir.join("MyGame.sln")).ok(); // leftover from a prior run
        let assets = dir.join("Assets/Scripts");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::create_dir_all(dir.join("ProjectSettings")).unwrap();
        std::fs::write(dir.join("ProjectSettings/ProjectVersion.txt"), "m_EditorVersion: 6000.0.0f1").unwrap();
        std::fs::write(assets.join("Foo.cs"), "// test").unwrap();

        let root = dir.to_string_lossy().replace('\\', "/");
        let frame = format!("{root}/Assets/Scripts/Foo.cs");
        assert_eq!(infer_root([frame.as_str()].into_iter()).as_deref(), Some(root.as_str()));
        assert!(infer_root([r"C:\NotAProject\Assets\X.cs"].into_iter()).is_none());

        // CI path re-rooted onto the local root
        let ci = r"C:\CICD\_work\G\G\Assets\Scripts\Foo.cs";
        assert!(resolve_local(Some(&root), ci).unwrap().is_file());
        assert!(resolve_local(Some(&root), r"Assets\Scripts\Missing.cs").is_none());
        assert!(resolve_local(None, ci).is_none());

        // sln discovery
        assert!(find_sln(&root).is_none());
        std::fs::write(dir.join("MyGame.sln"), "").unwrap();
        assert!(find_sln(&root).unwrap().ends_with("MyGame.sln"));
    }

    #[test]
    fn editor_kind_by_exe_name() {
        assert_eq!(editor_kind(r"C:\...\Common7\IDE\devenv.exe"), EditorKind::Devenv);
        assert_eq!(editor_kind(r"C:\Program Files\JetBrains\Rider\bin\rider64.exe"), EditorKind::Rider);
        assert_eq!(editor_kind(r"C:\Users\x\AppData\Local\Programs\Microsoft VS Code\Code.exe"), EditorKind::Code);
        assert_eq!(editor_kind(r"C:\Program Files\Sublime Text\sublime_text.exe"), EditorKind::Sublime);
        assert_eq!(editor_kind(r"C:\tools\notepad++.exe"), EditorKind::Other);
    }

    #[test]
    fn editor_args_per_kind() {
        let sln = Some(r"D:\P\Game.sln");
        let root = Some(r"D:\P");
        let f = r"D:\P\Assets\A.cs";
        assert_eq!(
            editor_args(EditorKind::Devenv, sln, root, f, 59, false),
            vec![r"D:\P\Game.sln", f, "/Command", "Edit.GoTo 59"]
        );
        assert_eq!(
            editor_args(EditorKind::Devenv, sln, root, f, 59, true),
            vec!["/Edit", f, "/Command", "Edit.GoTo 59"]
        );
        assert_eq!(
            editor_args(EditorKind::Rider, sln, root, f, 59, false),
            vec![r"D:\P\Game.sln", "--line", "59", f]
        );
        assert_eq!(
            editor_args(EditorKind::Code, None, root, f, 59, false),
            vec![r"D:\P", "-g", &format!("{f}:59")]
        );
        assert_eq!(editor_args(EditorKind::Sublime, sln, root, f, 59, false), vec![format!("{f}:59")]);
        assert_eq!(editor_args(EditorKind::Other, sln, root, f, 59, false), vec![f]);
    }

    #[test]
    fn reg_hex_decodes_unity_editor_path() {
        // "C:\x.exe\0"
        assert_eq!(decode_reg_hex("433A5C782E65786500").as_deref(), Some(r"C:\x.exe"));
        assert!(decode_reg_hex("zz").is_none());
    }

    #[test]
    fn reg_sz_value_parses_localized_query_output() {
        let en = "HKEY_CURRENT_USER\\Software\\Classes\\.log\r\n    (Default)    REG_SZ    txtfile\r\n";
        assert_eq!(reg_sz_value(en).as_deref(), Some("txtfile"));
        let zh = "HKEY_CURRENT_USER\\Software\\Classes\\.log\r\n    (預設值)    REG_SZ    My App.log\r\n";
        assert_eq!(reg_sz_value(zh).as_deref(), Some("My App.log"));
        assert_eq!(reg_sz_value("no value here"), None);
    }

    #[test]
    fn collect_logs_respects_depth_and_cap() {
        let dir = std::env::temp_dir().join("ulv-test-scan");
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("sub/sub2")).unwrap();
        std::fs::write(dir.join("a.log"), "").unwrap();
        std::fs::write(dir.join("skip.txt"), "").unwrap();
        std::fs::write(dir.join("sub/b.log"), "").unwrap();
        std::fs::write(dir.join("sub/sub2/c.log"), "").unwrap();

        let count = |depth: u32, cap: usize| {
            let mut v = Vec::new();
            collect_logs(&dir, depth, cap, &mut v);
            v.len()
        };
        assert_eq!(count(0, 100), 1);
        assert_eq!(count(1, 100), 2);
        assert_eq!(count(2, 100), 3);
        assert_eq!(count(5, 2), 2, "cap must bound the scan");
    }

    #[test]
    fn cmdline_substitution() {
        assert_eq!(
            build_cmdline(r#"code -g "{path}:{line}""#, r"D:\P\Assets\A.cs", 42),
            r#"code -g "D:\P\Assets\A.cs:42""#
        );
    }
}
