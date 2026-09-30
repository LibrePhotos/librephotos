//! Process-tree CPU time and working set on Windows (the RSS equivalent).

use std::collections::{HashMap, HashSet};
use std::mem::{size_of, zeroed};

use serde::Serialize;
use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, SetProcessAffinityMask,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION,
};

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct TreeStat {
    pub procs: usize,
    pub cpu_s: f64,
    pub working_set: u64,
    pub private_bytes: u64,
}

fn ft(t: FILETIME) -> u64 {
    ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
}

fn process_table() -> HashMap<u32, u32> {
    let mut parent = HashMap::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return parent;
        }
        let mut e: PROCESSENTRY32W = zeroed();
        e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                parent.insert(e.th32ProcessID, e.th32ParentProcessID);
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    parent
}

/// `roots` and all their descendants.
pub fn tree(roots: &[u32]) -> Vec<u32> {
    let parent = process_table();
    let mut set: HashSet<u32> = roots.iter().copied().filter(|p| parent.contains_key(p)).collect();
    loop {
        let before = set.len();
        for (&pid, &ppid) in &parent {
            if set.contains(&ppid) && pid != ppid {
                set.insert(pid);
            }
        }
        if set.len() == before {
            break;
        }
    }
    set.into_iter().collect()
}

unsafe fn handle_stat(h: HANDLE) -> Option<(f64, u64, u64)> {
    let (mut c, mut x, mut k, mut u): (FILETIME, FILETIME, FILETIME, FILETIME) =
        (zeroed(), zeroed(), zeroed(), zeroed());
    if GetProcessTimes(h, &mut c, &mut x, &mut k, &mut u) == 0 {
        return None;
    }
    let mut m: PROCESS_MEMORY_COUNTERS_EX = zeroed();
    m.cb = size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
    let ok = GetProcessMemoryInfo(h, &mut m as *mut _ as *mut _, m.cb);
    let cpu = (ft(k) + ft(u)) as f64 / 1e7;
    if ok == 0 {
        return Some((cpu, 0, 0));
    }
    Some((cpu, m.WorkingSetSize as u64, m.PrivateUsage as u64))
}

pub fn tree_stat(roots: &[u32]) -> TreeStat {
    tree_stat_detail(roots).0
}

/// Also (pid, cpu seconds, working set) per process, so a sampler can keep the
/// CPU time of processes that exit between samples (recycled workers).
pub fn tree_stat_detail(roots: &[u32]) -> (TreeStat, Vec<(u32, f64, u64)>) {
    let mut s = TreeStat::default();
    let mut detail = Vec::new();
    if roots.is_empty() {
        return (s, detail);
    }
    for pid in tree(roots) {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h == 0 {
                continue;
            }
            if excluded(&image_path(h)) {
                CloseHandle(h);
                continue;
            }
            if let Some((cpu, ws, pb)) = handle_stat(h) {
                s.procs += 1;
                s.cpu_s += cpu;
                s.working_set += ws;
                s.private_bytes += pb;
                detail.push((pid, cpu, ws));
            }
            CloseHandle(h);
        }
    }
    (s, detail)
}

pub fn self_cpu() -> f64 {
    unsafe { handle_stat(GetCurrentProcess()).map(|s| s.0).unwrap_or(0.0) }
}

/// Samples a process tree every `period` until stopped; keeps the peak and mean working set.
pub struct Sampler {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    handle: Option<std::thread::JoinHandle<(u64, f64, usize)>>,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct SampleSummary {
    pub peak_working_set: u64,
    pub mean_working_set: f64,
    pub samples: usize,
}

impl Sampler {
    pub fn start(roots: Vec<u32>, period: std::time::Duration) -> Self {
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = stop.clone();
        let handle = std::thread::spawn(move || {
            let (mut peak, mut sum, mut n) = (0u64, 0f64, 0usize);
            while !flag.load(std::sync::atomic::Ordering::Relaxed) {
                if !roots.is_empty() {
                    let s = tree_stat(&roots);
                    peak = peak.max(s.working_set);
                    sum += s.working_set as f64;
                    n += 1;
                }
                std::thread::sleep(period);
            }
            (peak, sum, n)
        });
        Sampler { stop, handle: Some(handle) }
    }

    pub fn finish(mut self) -> SampleSummary {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let (peak, sum, n) = self.handle.take().unwrap().join().unwrap_or((0, 0.0, 0));
        SampleSummary {
            peak_working_set: peak,
            mean_working_set: if n > 0 { sum / n as f64 } else { 0.0 },
            samples: n,
        }
    }
}

/// Full image path of a process, lower-cased ("" when it cannot be read).
unsafe fn image_path(h: HANDLE) -> String {
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) == 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize]).to_lowercase()
}

/// Processes whose image path contains one of these (LPBENCH_EXCLUDE, `;`-separated)
/// are left out of tree stats: the Git Bash wrapper and the venv's python.exe
/// launcher stub exist only because of how this Windows box starts Django.
fn excluded(path: &str) -> bool {
    std::env::var("LPBENCH_EXCLUDE")
        .unwrap_or_default()
        .split(';')
        .map(|s| s.trim().to_lowercase())
        .any(|s| !s.is_empty() && path.contains(&s))
}

/// Pin `roots` and their descendants to the CPUs in `mask`.
pub fn set_affinity(roots: &[u32], mask: usize) -> usize {
    let mut n = 0;
    for pid in tree(roots) {
        unsafe {
            let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h == 0 {
                continue;
            }
            if SetProcessAffinityMask(h, mask) != 0 {
                n += 1;
            }
            CloseHandle(h);
        }
    }
    n
}

pub fn pin_self(mask: usize) {
    unsafe {
        SetProcessAffinityMask(GetCurrentProcess(), mask);
    }
}
