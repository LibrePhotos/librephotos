"""The standalone build's icon in the notification area (Windows).

Without a console window it is the application's only surface, so it is there
from the first second of a start (#2316): its tooltip and its first, greyed
menu line say what LibrePhotos is doing ("Updating the database (3 of 7)"),
and a notification says so once when that takes long. Before, the icon only
appeared once migrations, startup commands and sidecars were done; after an
update that was minutes of nothing, and users double-clicked again.

Once the server runs, the menu also has Check for updates, and an update
item while a newer release is known: it downloads it, then restarts into it
(#2311, #2788, api/updates/tray.py).
"""

from __future__ import annotations

import os
import sys
import threading
import webbrowser
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pystray
    from PIL import Image

    from librephotos.macos_app import MainThread, Termination

APP_NAME = "LibrePhotos"
# Windows cuts a notification-area tooltip at 127 characters.
_TOOLTIP_LIMIT = 127
# How long a notification waits for the icon to be shown at all.
_SHOWN_TIMEOUT_SECONDS = 5.0


def tray_image(candidates: tuple[str, ...]) -> Image.Image:
    """The first icon file that exists, or a plain blue square."""
    from PIL import Image

    for candidate in candidates:
        if os.path.exists(candidate):
            return Image.open(candidate)
    return Image.new("RGB", (64, 64), (30, 120, 200))


@dataclass(frozen=True)
class MenuBar:
    main_thread: MainThread
    termination: Termination
    start_at_login: Callable[[], bool]
    toggle_start_at_login: Callable[[], None]


def _open_folder(path: str) -> None:
    if sys.platform == "win32":
        os.startfile(path)
    elif sys.platform == "darwin":
        from librephotos.macos_app import open_path

        open_path(path)


@dataclass(frozen=True)
class TraySetup:
    url: str
    image: Image.Image
    status: str
    on_quit: Callable[[], None]
    folders: tuple[str, str]
    menu_bar: MenuBar | None = None


class Tray:
    """The icon, its status line and its menu.

    Menu: the status (greyed), Open LibrePhotos (the default, a plain click),
    the update item (while a newer release is known), Check for updates
    (once Django is set up), Open data folder, Open logs, Quit LibrePhotos.
    Every method is safe to call from any thread.
    """

    def __init__(self, setup: TraySetup) -> None:
        import pystray

        url, image, on_quit, menu_bar = (
            setup.url,
            setup.image,
            setup.on_quit,
            setup.menu_bar,
        )
        self.menu_bar = menu_bar
        self.url = url
        self._status = setup.status
        self._update_label: str | None = None
        self._update_action: Callable[[], None] | None = None
        self._on_check_updates: Callable[[], None] | None = None
        self._shown = threading.Event()
        data_folder, logs_folder = setup.folders

        def open_folder(path: str) -> Callable[[object, object], None]:
            def open_it(icon: object, item: object) -> None:
                _open_folder(path)

            return open_it

        def quit_app(icon: pystray.Icon, item: pystray.MenuItem) -> None:
            on_quit()
            icon.stop()

        def make_icon() -> pystray.Icon:
            return pystray.Icon(
                "librephotos",
                image,
                self._tooltip(),
                menu=pystray.Menu(
                    pystray.MenuItem(lambda item: self._status, None, enabled=False),
                    pystray.Menu.SEPARATOR,
                    pystray.MenuItem(
                        "Open LibrePhotos",
                        lambda icon, item: webbrowser.open(url),
                        default=True,
                    ),
                    pystray.MenuItem(
                        self._update_text,
                        lambda icon, item: self._run_update(),
                        visible=self._update_shown,
                        enabled=self._update_enabled,
                    ),
                    pystray.MenuItem(
                        "Check for updates",
                        lambda icon, item: self._check_updates(),
                        visible=self._check_shown,
                    ),
                    pystray.MenuItem("Open data folder", open_folder(data_folder)),
                    pystray.MenuItem("Open logs", open_folder(logs_folder)),
                    pystray.MenuItem(
                        "Open at Login",
                        lambda icon, item: self._toggle_start_at_login(),
                        checked=lambda item: self._starts_at_login(),
                        visible=menu_bar is not None,
                    ),
                    pystray.Menu.SEPARATOR,
                    pystray.MenuItem("Quit LibrePhotos", quit_app),
                ),
            )

        if menu_bar is None:
            self.icon = make_icon()
            threading.Thread(target=self._run, daemon=True, name="tray").start()
        else:
            self.icon = menu_bar.main_thread.call(make_icon)
            menu_bar.main_thread.submit(self._run_menu_bar)

    def _run(self) -> None:
        self.icon.run(setup=self._setup)

    def _run_menu_bar(self) -> None:
        from librephotos.macos_app import install_quit_handlers

        if self.menu_bar is None:
            return
        self.menu_bar.main_thread.enter_appkit()
        try:
            install_quit_handlers(self.menu_bar.termination)
            self.icon.run(setup=self._setup)
        finally:
            self.menu_bar.main_thread.leave_appkit()

    def _ui(self, task: Callable[[], None]) -> None:
        if self.menu_bar is None:
            task()
        else:
            self.menu_bar.main_thread.submit(task)

    def _setup(self, icon: pystray.Icon) -> None:
        def show() -> None:
            icon.visible = True
            self._shown.set()

        self._ui(show)

    def _starts_at_login(self) -> bool:
        return self.menu_bar is not None and self.menu_bar.start_at_login()

    def _toggle_start_at_login(self) -> None:
        if self.menu_bar is not None:
            self.menu_bar.toggle_start_at_login()
            self._ui(self.icon.update_menu)

    def _tooltip(self) -> str:
        return f"{APP_NAME}: {self._status}"[:_TOOLTIP_LIMIT]

    @property
    def status(self) -> str:
        return self._status

    def set_status(self, status: str) -> None:
        self._status = status

        def show() -> None:
            self.icon.title = self._tooltip()
            self.icon.update_menu()

        self._ui(show)

    def _update_text(self, item: object) -> str:
        return self._update_label or ""

    def _update_shown(self, item: object) -> bool:
        return self._update_label is not None

    def _update_enabled(self, item: object) -> bool:
        return self._update_action is not None

    def _run_update(self) -> None:
        # It may download, ask a question or restart: never on the thread
        # that draws the menu.
        action = self._update_action
        if action is not None:
            threading.Thread(target=action, daemon=True, name="tray-update").start()

    def _check_shown(self, item: object) -> bool:
        return self._on_check_updates is not None

    def set_update(self, label: str | None, action: Callable[[], None] | None) -> None:
        """Show the update item with ``label`` (None hides it); choosing it
        runs ``action`` (None greys it out, as while a download runs)."""
        self._update_label = label
        self._update_action = action
        self._ui(self.icon.update_menu)

    def confirm(self, title: str, text: str) -> bool:
        """A Yes/No question in a message box; True for Yes."""
        if sys.platform == "darwin":
            from librephotos.macos_app import confirm

            return confirm(title, text)
        if sys.platform != "win32":
            return False
        import ctypes

        yes, yes_no_question = 6, 0x04 | 0x20
        return bool(
            ctypes.windll.user32.MessageBoxW(None, text, title, yes_no_question) == yes
        )

    def enable_update_check(self, on_check: Callable[[], None]) -> None:
        """Show Check for updates, which runs ``on_check`` in a thread of its own."""
        self._on_check_updates = on_check
        self._ui(self.icon.update_menu)

    def _check_updates(self) -> None:
        # It asks GitHub: never on the thread that draws the menu.
        if self._on_check_updates is not None:
            threading.Thread(
                target=self._on_check_updates, daemon=True, name="tray-check"
            ).start()

    def notify(self, title: str, message: str) -> None:
        """A Windows notification ("toast") from the icon."""
        self._shown.wait(_SHOWN_TIMEOUT_SECONDS)
        self.icon.notify(message, title)

    def stop(self) -> None:
        self._ui(self.icon.stop)
