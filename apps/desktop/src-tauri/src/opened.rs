use std::sync::Mutex;

#[derive(Default)]
pub struct Launch {
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    claimed: bool,
    pending: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Offer {
    Held(String),
    Deliver(String),
}

impl Launch {
    pub fn claim(&self, from_args: Option<String>) -> Option<String> {
        let mut state = self.state.lock().unwrap();
        state.claimed = true;
        state.pending.clone().or(from_args)
    }

    pub fn offer(&self, path: String) -> Offer {
        let mut state = self.state.lock().unwrap();
        if state.claimed {
            Offer::Deliver(path)
        } else {
            state.pending = Some(path.clone());
            Offer::Held(path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_opened_before_the_window_asks_becomes_the_first_picture() {
        let launch = Launch::default();
        assert_eq!(
            launch.offer("/p/a.jpg".into()),
            Offer::Held("/p/a.jpg".into())
        );
        assert_eq!(
            launch.offer("/p/b.heic".into()),
            Offer::Held("/p/b.heic".into())
        );
        assert_eq!(launch.claim(None), Some("/p/b.heic".into()));
        assert_eq!(
            launch.claim(None),
            Some("/p/b.heic".into()),
            "a reloaded window opens it again, like a command-line file"
        );
    }

    #[test]
    fn a_file_opened_after_the_window_asked_is_delivered_to_it() {
        let launch = Launch::default();
        assert_eq!(launch.claim(None), None);
        assert_eq!(
            launch.offer("/p/a.jpg".into()),
            Offer::Deliver("/p/a.jpg".into())
        );
        assert_eq!(launch.claim(None), None);
    }

    #[test]
    fn an_opened_file_wins_over_the_command_line() {
        let launch = Launch::default();
        assert_eq!(
            launch.claim(Some("/arg.jpg".into())),
            Some("/arg.jpg".into())
        );
        let launch = Launch::default();
        launch.offer("/event.jpg".into());
        assert_eq!(
            launch.claim(Some("/arg.jpg".into())),
            Some("/event.jpg".into())
        );
    }
}
