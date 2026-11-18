//! Read Claude Code's own session transcripts — the history behind "resume this session".
//!
//! Claude Code writes every session to `<config>/projects/<encoded cwd>/<sessionId>.jsonl` and keeps
//! it after the process is gone; `claude -r <id>` picks it back up **under the same id**. So resuming
//! needs no persistence layer of ours (the v1 "no session restore" rule is about *our* layout and
//! scrollback, which this doesn't touch) — only a reader and a launcher. ADR 0006.
//!
//! **The format is Claude Code's internal one, not a contract.** So this reads the minimum and
//! fails soft: the session id is the file name, the folder comes from `cwd`, the time is the file's
//! mtime, and the title is best-effort (`custom-title` → `ai-title` → `last-prompt`). A record type
//! that disappears costs a title, never the list.
//!
//! **Never read a whole transcript.** They run to hundreds of MB (235 MB measured). Every field we
//! need sits at an end: `cwd`/`entrypoint` are on the first lines (measured: within 1 KB), and the
//! title records are re-appended as the session runs, so the latest is near the tail (measured: within
//! 34 KB for every interactive session). Head 8 KB + tail 64 KB, cached on (mtime, length).

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const HEAD_BYTES: u64 = 8 * 1024;
const TAIL_BYTES: u64 = 64 * 1024;
/// How many sessions the rail lists.
const MAX_RECENT: usize = 20;
/// How many of the newest files to open at most. Some turn out to be SDK runs or empty sessions and
/// are skipped, so look somewhat past `MAX_RECENT` — but bounded, so a huge history stays cheap.
const MAX_CANDIDATES: usize = 60;
const TITLE_MAX_CHARS: usize = 120;

/// Which record the title came from — the rail styles a name the user chose differently from one
/// Claude generated or a raw prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TitleSource {
    /// `claude -n` / `/rename` — the user named it.
    Custom,
    /// Claude Code's generated title (what its own UI shows).
    Ai,
    /// No title yet: the last thing the user typed.
    Prompt,
}

/// What we keep from one transcript. Everything optional: absence is the normal case for some field
/// on some Claude Code version.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Meta {
    pub cwd: Option<String>,
    pub git_branch: Option<String>,
    pub entrypoint: Option<String>,
    pub custom_title: Option<String>,
    pub ai_title: Option<String>,
    pub last_prompt: Option<String>,
}

impl Meta {
    /// The best name available, and where it came from.
    pub fn title(&self) -> Option<(String, TitleSource)> {
        let pick = |v: &Option<String>, src| v.as_deref().and_then(clean_title).map(|t| (t, src));
        pick(&self.custom_title, TitleSource::Custom)
            .or_else(|| pick(&self.ai_title, TitleSource::Ai))
            .or_else(|| pick(&self.last_prompt, TitleSource::Prompt))
    }

    /// A session a person ran. `claude -p` and Agent SDK runs record `sdk-*` (verified: a `-p` run
    /// writes `sdk-cli`) — tools driving Claude, not conversations anyone resumes by hand. A missing
    /// entrypoint (older versions) counts as interactive: hiding real sessions is the worse error.
    pub fn is_interactive(&self) -> bool {
        !self.entrypoint.as_deref().is_some_and(|e| e.starts_with("sdk"))
    }
}

/// Fold a run of JSONL bytes into `meta`. Call with the head first, then the tail: **later lines win**
/// for titles and branch (they are newer), while `cwd` and `entrypoint` keep the first value seen —
/// the folder a session *started* in is the project `claude -r` must run from.
///
/// `starts_mid_line`: the bytes begin at an arbitrary offset (a tail window), so the first line is a
/// fragment and is dropped. A truncated *last* line needs no flag — it simply fails to parse.
pub fn fold(meta: &mut Meta, bytes: &[u8], starts_mid_line: bool) {
    let mut lines = bytes.split(|b| *b == b'\n');
    if starts_mid_line {
        lines.next();
    }
    for line in lines {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(line) else { continue };
        let s = |k: &str| v.get(k).and_then(Value::as_str).filter(|x| !x.is_empty()).map(str::to_owned);
        match v.get("type").and_then(Value::as_str) {
            Some("custom-title") => meta.custom_title = s("customTitle").or(meta.custom_title.take()),
            Some("ai-title") => meta.ai_title = s("aiTitle").or(meta.ai_title.take()),
            Some("last-prompt") => meta.last_prompt = s("lastPrompt").or(meta.last_prompt.take()),
            _ => {}
        }
        if meta.cwd.is_none() {
            meta.cwd = s("cwd");
        }
        if meta.entrypoint.is_none() {
            meta.entrypoint = s("entrypoint");
        }
        // `HEAD` is what's recorded outside a repo or on a detached head (measured) — not a branch name
        // worth a label. Clear rather than skip: it's the newer fact about where the session stands.
        if let Some(b) = s("gitBranch") {
            meta.git_branch = (b != "HEAD").then_some(b);
        }
    }
}

/// One line, trimmed, capped — a title is a label, and `last-prompt` can be a pasted page.
pub fn clean_title(raw: &str) -> Option<String> {
    let line = raw.lines().map(str::trim).find(|l| !l.is_empty())?;
    let line: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= TITLE_MAX_CHARS {
        return Some(line);
    }
    let mut cut: String = line.chars().take(TITLE_MAX_CHARS - 1).collect();
    cut.push('…');
    Some(cut)
}

/// Claude Code session ids are UUIDs. Checked before an id is ever put into a command line —
/// file names are under the user's control, and `claude -r <id>` is typed into a shell.
pub fn is_session_id(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// `<config>/projects`. Honors `CLAUDE_CONFIG_DIR` the way Claude Code does, else `~/.claude`.
pub fn projects_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(d).join("projects"));
    }
    std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".claude").join("projects"))
}

/// Read head + tail of one transcript.
fn read_meta(path: &Path, len: u64) -> std::io::Result<Meta> {
    let mut f = File::open(path)?;
    let mut meta = Meta::default();
    let mut head = Vec::with_capacity(len.min(HEAD_BYTES) as usize);
    (&mut f).take(HEAD_BYTES).read_to_end(&mut head)?;
    fold(&mut meta, &head, false);
    if len > HEAD_BYTES {
        let start = len.saturating_sub(TAIL_BYTES);
        f.seek(SeekFrom::Start(start))?;
        let mut tail = Vec::with_capacity(TAIL_BYTES as usize);
        // `take`, not read-to-EOF: the file may be growing under a live session.
        f.take(TAIL_BYTES).read_to_end(&mut tail)?;
        fold(&mut meta, &tail, start > 0);
    }
    Ok(meta)
}

struct Cached {
    mtime: SystemTime,
    len: u64,
    meta: Meta,
}

/// Parsed metadata by path, valid while (mtime, length) match. Shared by the rail's list and the live
/// board's titles, so an active session's transcript is re-read only when it actually changed.
fn cache() -> &'static Mutex<HashMap<PathBuf, Cached>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Cached>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Metadata for one transcript, from the cache when the file hasn't changed. `None` = unreadable.
pub fn meta_for(path: &Path) -> Option<Meta> {
    let md = std::fs::metadata(path).ok()?;
    let (mtime, len) = (md.modified().ok()?, md.len());
    if let Some(c) = cache().lock().unwrap().get(path) {
        if c.mtime == mtime && c.len == len {
            return Some(c.meta.clone());
        }
    }
    // Read outside the lock: the session poll thread shares this cache and must not wait on a disk.
    let meta = read_meta(path, len).ok()?;
    cache().lock().unwrap().insert(path.to_path_buf(), Cached { mtime, len, meta: meta.clone() });
    Some(meta)
}

/// The display title for a live session's transcript (the board's card name).
pub fn title_for(transcript: &str) -> Option<(String, TitleSource)> {
    meta_for(Path::new(transcript))?.title()
}

/// One resumable session for the rail (camelCase JSON).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentSession {
    pub session_id: String,
    /// Which agent wrote it — and so which command resumes it. Only `"claude"` exists today; the field
    /// is here so the frontend never has to assume.
    pub agent: &'static str,
    pub title: String,
    pub title_source: TitleSource,
    pub cwd: String,
    pub project: String,
    /// The folder is gone (moved, deleted, a removed worktree) — resume can't run there, and the rail
    /// says so instead of launching into an error.
    pub cwd_exists: bool,
    pub git_branch: Option<String>,
    /// Last write to the transcript, unix milliseconds.
    pub last_active: i64,
}

/// A transcript file on disk, before it's opened.
struct Candidate {
    path: PathBuf,
    id: String,
    mtime: SystemTime,
}

/// Every `<projects>/<dir>/<uuid>.jsonl`, newest first. **One level only** — the per-session
/// subfolders hold sub-agent transcripts, which are not sessions anyone resumes.
fn candidates(root: &Path) -> Vec<Candidate> {
    let mut out = Vec::new();
    let Ok(dirs) = std::fs::read_dir(root) else { return out };
    for dir in dirs.flatten() {
        if !dir.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Ok(files) = std::fs::read_dir(dir.path()) else { continue };
        for f in files.flatten() {
            let path = f.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()).filter(|s| is_session_id(s)) else {
                continue;
            };
            let Ok(mtime) = f.metadata().and_then(|m| m.modified()) else { continue };
            out.push(Candidate { id: id.to_owned(), path, mtime });
        }
    }
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    out
}

/// Turn a parsed transcript into a list row — or `None` if it isn't something to offer: an SDK run,
/// no folder to resume in, or no title at all (a session opened and closed without a prompt).
fn to_recent(id: &str, mtime: SystemTime, meta: &Meta, cwd_exists: impl Fn(&str) -> bool) -> Option<RecentSession> {
    if !meta.is_interactive() {
        return None;
    }
    let cwd = meta.cwd.clone()?;
    let (title, title_source) = meta.title()?;
    Some(RecentSession {
        session_id: id.to_owned(),
        agent: "claude",
        title,
        title_source,
        project: crate::sessions::project_name(Some(&cwd)),
        cwd_exists: cwd_exists(&cwd),
        cwd,
        git_branch: meta.git_branch.clone(),
        last_active: mtime.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64),
    })
}

/// The newest resumable sessions. Fail-soft: no Claude Code, no folder, unreadable files → fewer rows.
pub fn recent(limit: usize) -> Vec<RecentSession> {
    let Some(root) = projects_dir() else { return Vec::new() };
    let all = candidates(&root);
    let mut out = Vec::new();
    for c in all.iter().take(MAX_CANDIDATES) {
        if out.len() >= limit {
            break;
        }
        let Some(meta) = meta_for(&c.path) else { continue };
        if let Some(r) = to_recent(&c.id, c.mtime, &meta, |p| Path::new(p).is_dir()) {
            out.push(r);
        }
    }
    // Keep the cache bounded to what could still be asked for (the list window + live sessions, which
    // are among the newest files anyway).
    let keep: std::collections::HashSet<&Path> = all.iter().take(MAX_CANDIDATES).map(|c| c.path.as_path()).collect();
    cache().lock().unwrap().retain(|p, _| keep.contains(p.as_path()));
    out
}

/// The rail's "recent" list. File I/O ⇒ `(async)` (ADR 0003).
#[tauri::command(async)]
pub fn recent_sessions() -> Vec<RecentSession> {
    recent(MAX_RECENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "39f7d04d-7f7b-4739-9c59-d9c73c56ade0";

    fn folded(chunks: &[(&str, bool)]) -> Meta {
        let mut m = Meta::default();
        for (bytes, mid) in chunks {
            fold(&mut m, bytes.as_bytes(), *mid);
        }
        m
    }

    /// The precedence the rail promises: a name the user gave beats Claude's, which beats a raw prompt.
    #[test]
    fn title_prefers_custom_then_ai_then_prompt() {
        let mut m = Meta { last_prompt: Some("fix the bug".into()), ..Default::default() };
        assert_eq!(m.title(), Some(("fix the bug".into(), TitleSource::Prompt)));
        m.ai_title = Some("Fix login bug".into());
        assert_eq!(m.title(), Some(("Fix login bug".into(), TitleSource::Ai)));
        m.custom_title = Some("auth-work".into());
        assert_eq!(m.title(), Some(("auth-work".into(), TitleSource::Custom)));
        // A blank custom title is no title — fall through rather than show an empty card.
        m.custom_title = Some("   ".into());
        assert_eq!(m.title().unwrap().1, TitleSource::Ai);
        assert_eq!(Meta::default().title(), None);
    }

    /// Shapes copied from real transcripts (CLI 2.1.327) — `custom-title` from a probe `claude -n` run.
    #[test]
    fn fold_reads_real_record_shapes() {
        let m = folded(&[(
            concat!(
                r#"{"type":"custom-title","customTitle":"probe-name","sessionId":"x"}"#, "\n",
                r#"{"type":"user","cwd":"C:\\w\\deck","entrypoint":"cli","gitBranch":"main","message":{}}"#, "\n",
                r#"{"type":"ai-title","aiTitle":"Review resume feature","sessionId":"x"}"#, "\n",
                r#"{"type":"last-prompt","lastPrompt":"go on","sessionId":"x"}"#, "\n",
            ),
            false,
        )]);
        assert_eq!(m.cwd.as_deref(), Some("C:\\w\\deck"));
        assert_eq!(m.entrypoint.as_deref(), Some("cli"));
        assert_eq!(m.git_branch.as_deref(), Some("main"));
        assert_eq!(m.custom_title.as_deref(), Some("probe-name"));
        assert_eq!(m.ai_title.as_deref(), Some("Review resume feature"));
        assert_eq!(m.last_prompt.as_deref(), Some("go on"));
    }

    /// Head then tail: titles and branch move forward, the starting folder does not.
    #[test]
    fn tail_updates_titles_but_not_the_starting_folder() {
        let head = concat!(
            r#"{"type":"user","cwd":"C:\\start","entrypoint":"cli","gitBranch":"main"}"#, "\n",
            r#"{"type":"ai-title","aiTitle":"old title"}"#, "\n",
        );
        let tail = concat!(
            r#"{"type":"user","cwd":"C:\\elsewhere","entrypoint":"sdk-cli","gitBranch":"develop-x"}"#, "\n",
            r#"{"type":"ai-title","aiTitle":"new title"}"#, "\n",
        );
        let m = folded(&[(head, false), (tail, false)]);
        assert_eq!(m.cwd.as_deref(), Some("C:\\start"));
        assert_eq!(m.entrypoint.as_deref(), Some("cli"));
        assert_eq!(m.git_branch.as_deref(), Some("develop-x"));
        assert_eq!(m.ai_title.as_deref(), Some("new title"));
    }

    /// A tail window starts mid-line. That fragment must be dropped — and a truncated last line (the
    /// session is still writing) must be ignored rather than poison the rest.
    #[test]
    fn fold_survives_window_edges() {
        let tail = concat!(
            r#"tle","aiTitle":"FRAGMENT"}"#, "\n",
            r#"{"type":"ai-title","aiTitle":"whole"}"#, "\r\n",
            r#"{"type":"ai-title","aiTi"#,
        );
        let m = folded(&[(tail, true)]);
        assert_eq!(m.ai_title.as_deref(), Some("whole"));
        // A fragment can happen to be valid JSON on its own (the cut fell inside a string, just after
        // a nested object). Titles would shrug that off — later lines overwrite — but `cwd` keeps the
        // *first* value, so only the flag stops a fragment from choosing the folder resume runs in.
        let m = folded(&[(
            concat!(r#"{"cwd":"C:\\fragment"}"#, "\n", r#"{"type":"user","cwd":"C:\\real"}"#),
            true,
        )]);
        assert_eq!(m.cwd.as_deref(), Some("C:\\real"));
    }

    /// An empty value is not an update — it must not erase a title an earlier line gave.
    #[test]
    fn empty_values_do_not_erase() {
        let m = folded(&[(
            concat!(r#"{"type":"ai-title","aiTitle":"kept"}"#, "\n", r#"{"type":"ai-title","aiTitle":""}"#, "\n", r#"{"type":"user","gitBranch":""}"#),
            false,
        )]);
        assert_eq!(m.ai_title.as_deref(), Some("kept"));
        assert_eq!(m.git_branch, None);
    }

    /// `HEAD` (no repo / detached) is not a branch to show — and it replaces an older real branch,
    /// because it is the newer fact.
    #[test]
    fn head_is_not_a_branch() {
        let m = folded(&[(concat!(r#"{"gitBranch":"main"}"#, "\n", r#"{"gitBranch":"HEAD"}"#), false)]);
        assert_eq!(m.git_branch, None);
    }

    #[test]
    fn clean_title_is_one_capped_line() {
        assert_eq!(clean_title("\n\n  first   line  \nsecond").as_deref(), Some("first line"));
        assert_eq!(clean_title("   \n "), None);
        let long = "가".repeat(300); // multi-byte: the cap must count chars, not bytes
        let t = clean_title(&long).unwrap();
        assert_eq!(t.chars().count(), TITLE_MAX_CHARS);
        assert!(t.ends_with('…'));
    }

    /// This guards a command line. Anything but a bare UUID is refused.
    #[test]
    fn only_uuids_are_session_ids() {
        assert!(is_session_id(ID));
        assert!(is_session_id(&ID.to_uppercase()));
        for bad in ["", "abc", "39f7d04d-7f7b-4739-9c59-d9c73c56ade", "39f7d04d-7f7b-4739-9c59-d9c73c56ade0x",
            "39f7d04d_7f7b-4739-9c59-d9c73c56ade0", "39f7d04d-7f7b-4739-9c59-d9c73c56ade;", "../../../../../../../../../x.json"] {
            assert!(!is_session_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn to_recent_offers_only_resumable_sessions() {
        let t = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        let ok = Meta { cwd: Some("C:\\w\\deck".into()), entrypoint: Some("cli".into()), ai_title: Some("t".into()), ..Default::default() };
        let r = to_recent(ID, t, &ok, |_| true).unwrap();
        assert_eq!((r.project.as_str(), r.title_source, r.last_active), ("deck", TitleSource::Ai, 1_700_000_000_000));
        assert!(!to_recent(ID, t, &ok, |_| false).unwrap().cwd_exists);

        let sdk = Meta { entrypoint: Some("sdk-cli".into()), ..ok.clone() };
        assert!(to_recent(ID, t, &sdk, |_| true).is_none(), "SDK runs are not offered");
        let no_cwd = Meta { cwd: None, ..ok.clone() };
        assert!(to_recent(ID, t, &no_cwd, |_| true).is_none(), "nowhere to resume");
        let untitled = Meta { ai_title: None, ..ok.clone() };
        assert!(to_recent(ID, t, &untitled, |_| true).is_none(), "never prompted = nothing to resume");
        let legacy = Meta { entrypoint: None, ..ok };
        assert!(to_recent(ID, t, &legacy, |_| true).is_some(), "missing entrypoint counts as interactive");
    }

    /// End to end on real files: head/tail windows on a file bigger than both, the cache noticing a
    /// change, and the one-level scan skipping sub-agent folders and non-UUID names.
    #[test]
    fn reads_real_files_and_tracks_changes() {
        let root = std::env::temp_dir().join(format!("clowder-test-transcripts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let proj = root.join("C--w-deck");
        std::fs::create_dir_all(proj.join(ID).join("subagents")).unwrap();
        let path = proj.join(format!("{ID}.jsonl"));

        let mut body = String::from(r#"{"type":"user","cwd":"C:\\w\\deck","entrypoint":"cli"}"#);
        body.push('\n');
        let filler = format!("{}\n", r#"{"type":"assistant","message":{"x":"................................................................"}}"#);
        while body.len() < (HEAD_BYTES + TAIL_BYTES) as usize * 2 {
            body.push_str(&filler); // middle that neither window covers
        }
        body.push_str(concat!(r#"{"type":"ai-title","aiTitle":"from the tail"}"#, "\n"));
        std::fs::write(&path, &body).unwrap();
        std::fs::write(proj.join(ID).join("subagents").join("agent-1.jsonl"), "{}").unwrap();
        std::fs::write(proj.join("not-a-uuid.jsonl"), "{}").unwrap();

        let m = meta_for(&path).unwrap();
        assert_eq!(m.cwd.as_deref(), Some("C:\\w\\deck"));
        assert_eq!(m.ai_title.as_deref(), Some("from the tail"));

        // A rename lands at the end; the length change must invalidate the cache.
        body.push_str(concat!(r#"{"type":"custom-title","customTitle":"renamed"}"#, "\n"));
        std::fs::write(&path, &body).unwrap();
        assert_eq!(title_for(&path.to_string_lossy()), Some(("renamed".into(), TitleSource::Custom)));

        let found: Vec<String> = candidates(&root).into_iter().map(|c| c.id).collect();
        assert_eq!(found, vec![ID.to_string()]);

        let _ = std::fs::remove_dir_all(&root);
    }
}
