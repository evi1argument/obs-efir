class LivePreview {
  constructor(video, label, request, onChange) {
    this.video = video;
    this.label = label;
    this.request = request;
    this.onChange = onChange;
    this.active = false;
    this.connected = false;
    this.video.muted = true;
    this.video.disableRemotePlayback = true;
    video.addEventListener('playing', () => this.show(true));
    video.addEventListener('waiting', () => { this.label.textContent = 'Буферизация…'; });
    if (video.requestVideoFrameCallback) {
      const measure = (now, { presentedFrames }) => {
        const previous = this.lastMeasure;
        if (previous && now - previous.now >= 1000 && this.connected && this.active) {
          const fps = Math.round((presentedFrames - previous.frames) * 1000 / (now - previous.now));
          if (fps > 0) this.label.textContent = fps + ' кадр/с · без звука';
          this.lastMeasure = { now, frames: presentedFrames };
        }
        this.lastMeasure ??= { now, frames: presentedFrames };
        video.requestVideoFrameCallback(measure);
      };
      video.requestVideoFrameCallback(measure);
    }
  }

  show(active) {
    if (this.active === active) return;
    this.active = active;
    this.lastMeasure = undefined;
    this.onChange(active);
  }

  ensure() {
    if (this.controller || document.hidden || Date.now() < (this.retryAfter || 0)) return;
    const Media = globalThis.ManagedMediaSource || globalThis.MediaSource;
    if (!Media) return;
    const controller = new AbortController();
    this.controller = controller;
    this.run(Media, controller).catch(() => {}).finally(() => {
      if (this.controller !== controller) return;
      this.stop();
      this.retryAfter = Date.now() + 3000;
    });
  }

  stop() {
    this.controller?.abort();
    this.controller = null;
    this.connected = false;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.show(false);
  }

  async run(Media, controller) {
    const { signal } = controller;
    const media = new Media();
    let watchdog;
    let reader;
    const monitor = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), 8000);
    };
    monitor();
    try {
      const response = await this.request('/api/video', { signal });
      const codec = response.headers.get('X-OBS-Codec');
      const type = 'video/mp4; codecs="' + codec + '"';
      if (!Media.isTypeSupported(type)) throw new Error('H.264 unavailable');
      if (signal.aborted) return;
      this.url = URL.createObjectURL(media);
      const opened = this.wait(media, 'sourceopen', signal);
      this.video.src = this.url;
      await opened;
      const buffer = media.addSourceBuffer(type);
      this.connected = true;
      this.nominalFps = response.headers.get('X-OBS-FPS');
      if (!this.video.requestVideoFrameCallback) this.label.textContent = this.nominalFps + ' кадр/с · без звука';
      reader = response.body.getReader();
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        monitor();
        const updated = this.wait(buffer, 'updateend', signal);
        buffer.appendBuffer(value);
        await updated;
        if (!buffer.buffered.length) continue;
        const start = buffer.buffered.start(buffer.buffered.length - 1);
        const end = buffer.buffered.end(buffer.buffered.length - 1);
        const now = this.video.currentTime;
        if (now < start || end - now > 0.85) this.video.currentTime = Math.max(start, end - 0.22);
        else this.video.playbackRate = end - now > 0.42 ? 1.04 : 1;
        if (this.video.paused) this.video.play().catch(() => {});
        if (buffer.buffered.start(0) < now - 8) {
          const removed = this.wait(buffer, 'updateend', signal);
          buffer.remove(0, now - 4);
          await removed;
        }
      }
    } finally {
      clearTimeout(watchdog);
      await reader?.cancel().catch(() => {});
    }
  }

  wait(target, event, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      target.addEventListener(event, () => {
        signal.removeEventListener('abort', aborted);
        resolve();
      }, { once: true, signal });
    });
  }
}

