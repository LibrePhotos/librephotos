"""The standalone build's icon in the notification area (Windows).

Without a console window it is the application's only surface, so it is there
from the first second of a start (#2316): its tooltip and its first, greyed
menu line say what LibrePhotos is doing ("Updating the database (3 of 7)"),
and a notification says so once when that takes long. Before, the icon only
appeared once migrations, startup commands and sidecars were done; after an
update that was minutes of nothing, and users double-clicked again.

Once the server runs, the menu also has Check for updates, and Update to
1.5.0 available... while a newer release is known (#2311, api/updates/tray.py).
"""

from __future__ import annotations

import os
import sys
import threading
import webbrowser
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pystray
    from PIL import Image

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


class Tray:
    """The icon, its status line and its menu.

    Menu: the status (greyed), Open LibrePhotos (the default, a plain click),
    Update to <version> available... (while one is known), Check for updates
    (once Django is set up), Open data folder, Open logs, Quit LibrePhotos.
    Every method is safe to call from any thread.
    """

    def __init__(
        self,
        url: str,
        image: Image.Image,
        status: str,
        on_quit: Callable[[], None],
        folders: tuple[str, str],
    ) -> None:
        import pystray

        self.url = url
        self._status = status
        self._update_label: str | None = None
        self._update_url = ""
        self._on_check_updates: Callable[[], None] | None = None
        self._shown = threading.Event()
        data_folder, logs_folder = folders

        def open_folder(path: str) -> Callable[[object, object], None]:
            def open_it(icon: object, item: object) -> None:
                # The icon only exists on Windows (Startup.show_tray).
                if sys.platform == "win32":
                    os.startfile(path)

            return open_it

        def quit_app(icon: pystray.Icon, item: pystray.MenuItem) -> None:
            on_quit()
            icon.stop()

        self.icon = pystray.Icon(
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
                    self._update_text, self._open_update, visible=self._update_shown
                ),
                pystray.MenuItem(
                    "Check for updates",
                    lambda icon, item: self._check_updates(),
                    visible=self._check_shown,
                ),
                pystray.MenuItem("Open data folder", open_folder(data_folder)),
                pystray.MenuItem("Open logs", open_folder(logs_folder)),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quit LibrePhotos", quit_app),
            ),
        )
        threading.Thread(target=self._run, daemon=True, name="tray").start()

    def _run(self) -> None:
        self.icon.run(setup=self._setup)

    def _setup(self, icon: pystray.Icon) -> None:
        icon.visible = True
        self._shown.set()

    def _tooltip(self) -> str:
        return f"{APP_NAME}: {self._status}"[:_TOOLTIP_LIMIT]

    @property
    def status(self) -> str:
        return self._status

    def set_status(self, status: str) -> None:
        self._status = status
        self.icon.title = self._tooltip()
        self.icon.update_menu()

    def _update_text(self, item: object) -> str:
        return self._update_label or ""

    def _update_shown(self, item: object) -> bool:
        return self._update_label is not None

    def _open_update(self, icon: object, item: object) -> None:
        webbrowser.open(self._update_url)

    def _check_shown(self, item: object) -> bool:
        return self._on_check_updates is not None

    def set_update(self, label: str | None, url: str) -> None:
        """Show the update item with ``label`` (None hides it); it opens ``url``."""
        self._update_label = label
        self._update_url = url
        self.icon.update_menu()

    def enable_update_check(self, on_check: Callable[[], None]) -> None:
        """Show Check for updates, which runs ``on_check`` in a thread of its own."""
        self._on_check_updates = on_check
        self.icon.update_menu()

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
        self.icon.stop()
