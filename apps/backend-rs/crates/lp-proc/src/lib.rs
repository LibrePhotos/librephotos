//! `.no_window()` for child processes: on Windows a console program started
//! from a process without a console (the server, the worker, the bench
//! harness) otherwise pops up its own console window.

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl NoWindow for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }
}
