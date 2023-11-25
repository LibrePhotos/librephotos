export class ScrollSpeed {
  lastPosition: number = -1;

  delta: number = 0;

  timeout: number = -1;

  clear = () => {
    this.lastPosition = -1;
    this.delta = 0;
    this.timeout = -1;
  };

  getScrollSpeed(scrollOffset: number) {
    if (this.lastPosition != null) {
      this.delta = scrollOffset - this.lastPosition;
    }
    this.lastPosition = scrollOffset;

    if (this.timeout !== -1) {
      this.clearTimeout();
    }
    this.timeout = window.setTimeout(this.clear, 50);

    return this.delta;
  }

  clearTimeout() {
    window.clearTimeout(this.timeout);
  }
}

export const SCROLL_DEBOUNCE_DURATION = 250; // In milliseconds
