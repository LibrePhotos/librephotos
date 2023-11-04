export class ScrollSpeed {
  clear = () => {
    this.lastPosition = null;
    this.delta = 0;
    this.timeout = null;
  };

  getScrollSpeed(scrollOffset) {
    if (this.lastPosition != null) {
      this.delta = scrollOffset - this.lastPosition;
    }
    this.lastPosition = scrollOffset;

    window.clearTimeout(this.timeout);
    this.timeout = window.setTimeout(this.clear, 50);

    return this.delta;
  }

  clearTimeout() {
    window.clearTimeout(this.timeout);
  }
}

export const SPEED_THRESHOLD = 500; // Tweak this to whatever feels right for your app
export const SCROLL_DEBOUNCE_DURATION = 250; // In milliseconds
