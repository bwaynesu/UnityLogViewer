use serde::Serialize;

/// System metadata parsed from the startup banner at the head of a Unity log.
/// All fields optional — banners vary wildly across Unity versions and platforms.
#[derive(Debug, Default, Clone, Serialize)]
pub struct Banner {
    pub engine_version: Option<String>,
    pub graphics_api: Option<String>,
    pub renderer: Option<String>,
    pub vram_mb: Option<u32>,
    pub driver: Option<String>,
}

/// Scan the head of the log for known banner lines.
pub fn parse_banner(text: &str) -> Banner {
    let mut b = Banner::default();
    // first 200 lines is plenty for any real log; raise if one disproves it
    for raw in text.split('\n').take(200) {
        let line = raw.trim_end_matches('\r');
        let t = line.trim();
        if let Some(v) = t.strip_prefix("Initialize engine version: ") {
            b.engine_version = Some(v.to_string());
        } else if let Some(v) = t.strip_prefix("Version:") {
            // indented field of the Direct3D block, e.g. "Version:  Direct3D 11.0 [level 11.1]"
            if b.graphics_api.is_none() && line.starts_with(' ') {
                b.graphics_api = Some(v.trim().to_string());
            }
        } else if let Some(v) = t.strip_prefix("Renderer:") {
            if b.renderer.is_none() && line.starts_with(' ') {
                b.renderer = Some(v.trim().to_string());
            }
        } else if let Some(v) = t.strip_prefix("VRAM:") {
            if b.vram_mb.is_none() {
                b.vram_mb = v.trim().split(' ').next().and_then(|n| n.parse().ok());
            }
        } else if let Some(v) = t.strip_prefix("Driver:") {
            if b.driver.is_none() && line.starts_with(' ') {
                b.driver = Some(v.trim().to_string());
            }
        }
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_direct3d_banner() {
        // \x20 = explicit leading spaces (backslash line-continuation would strip them)
        let text = "Initialize engine version: 2020.3.0f1 (000000000000)\n\
                    Direct3D:\n\
                    \x20   Version:  Direct3D 11.0 [level 11.1]\n\
                    \x20   Renderer: Example GPU 1000 (ID=0x0000)\n\
                    \x20   VRAM:     8192 MB\n\
                    \x20   Driver:   30.0.0.1000\n";
        let b = parse_banner(text);
        assert_eq!(b.engine_version.as_deref(), Some("2020.3.0f1 (000000000000)"));
        assert_eq!(b.graphics_api.as_deref(), Some("Direct3D 11.0 [level 11.1]"));
        assert_eq!(b.vram_mb, Some(8192));
        assert_eq!(b.driver.as_deref(), Some("30.0.0.1000"));
    }

    #[test]
    fn empty_input_gives_empty_banner() {
        let b = parse_banner("");
        assert!(b.engine_version.is_none());
    }
}
