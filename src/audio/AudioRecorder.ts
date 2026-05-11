// Captures the live mic stream during a play session and downloads it as a
// WebM file. Drop the downloaded file into public/samples/ and point
// src/test/main.ts:RECORDING_URL at it to iterate the detection algorithm
// against your real input offline.
//
// Activated by adding ?record=1 to the URL.

export class AudioRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  start(stream: MediaStream) {
    if (this.rec) return;
    this.chunks = [];
    this.rec = new MediaRecorder(stream, {
      ...this.pickMime(),
      // Default Opus is ~64kbps; transients survive much better at higher
      // rates. The recording is small enough that fidelity matters more.
      audioBitsPerSecond: 256000,
    });
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start();
    this.startedAt = performance.now();
  }

  /** Stop and trigger a browser download. Returns the duration captured. */
  async stopAndDownload(filenameBase = "outrun-axe-session"): Promise<number> {
    if (!this.rec) return 0;
    const dur = (performance.now() - this.startedAt) / 1000;
    await new Promise<void>((resolve) => {
      this.rec!.onstop = () => resolve();
      this.rec!.stop();
    });
    const blob = new Blob(this.chunks, { type: this.rec.mimeType || "audio/webm" });
    const ext = blob.type.includes("webm") ? "webm" : "ogg";
    const ts = new Date()
      .toISOString()
      .replace(/[T:.]/g, "-")
      .replace(/-\d{3}Z$/, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${filenameBase}-${ts}.${ext}`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    this.rec = null;
    this.chunks = [];
    return dur;
  }

  private pickMime(): MediaRecorderOptions {
    // Prefer Opus in WebM — best compression and broadly decodable.
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
      if (MediaRecorder.isTypeSupported(t)) return { mimeType: t };
    }
    return {};
  }
}
