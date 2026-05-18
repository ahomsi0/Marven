"use client";

// Local Whisper STT via transformers.js. The model (Xenova/whisper-tiny.en,
// ~150MB ONNX weights) downloads from Hugging Face's CDN on first use and is
// cached in IndexedDB (Electron persists IndexedDB between launches, so it's
// truly a one-time cost). Everything runs in the renderer via WASM/WebGPU —
// audio never leaves the machine.

export interface LocalSttProgress {
  status: "downloading" | "loading" | "ready" | "error";
  loaded?: number;     // bytes downloaded
  total?: number;      // total bytes for the current file
  file?: string;       // current file being downloaded
  message?: string;
}

const MODEL_ID = "Xenova/whisper-tiny.en";

// Pipeline is a singleton — we only load the model once per app session and
// the cached weights stay on disk between sessions.
let pipelinePromise: Promise<TranscribeFn> | null = null;

// We coalesce progress updates to whichever caller most recently subscribed.
// transformers.js fires progress at module construction, so callers that
// subscribe late still want to see fresh updates as bytes stream in.
let activeProgressCb: ((e: LocalSttProgress) => void) | null = null;

type TranscribeFn = (audio: Float32Array) => Promise<{ text: string }>;

/**
 * Lazy-load the Whisper pipeline. Subsequent calls return the same promise;
 * if you pass `onProgress`, it overrides any previous subscriber so the
 * Settings UI always shows the latest download bytes.
 */
export function getLocalSttPipeline(
  onProgress?: (e: LocalSttProgress) => void,
): Promise<TranscribeFn> {
  if (onProgress) activeProgressCb = onProgress;

  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        // Dynamic import — keeps the heavy onnxruntime-web out of the SSR
        // bundle and the initial client chunk. Only fetched once the user
        // actually triggers local STT.
        const tf = await import("@huggingface/transformers");
        const { pipeline, env } = tf;

        // Force remote model download (Hugging Face CDN), but cache locally
        // via IndexedDB.
        env.allowLocalModels = false;
        env.allowRemoteModels = true;

        activeProgressCb?.({ status: "loading", message: "Loading model…" });

        const pipe = await pipeline(
          "automatic-speech-recognition",
          MODEL_ID,
          {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            progress_callback: (data: any) => {
              if (!activeProgressCb) return;
              if (data?.status === "progress") {
                activeProgressCb({
                  status: "downloading",
                  loaded: data.loaded,
                  total: data.total,
                  file: data.file,
                });
              } else if (data?.status === "ready") {
                activeProgressCb({ status: "ready" });
              }
            },
          },
        );

        activeProgressCb?.({ status: "ready" });

        return async (audio: Float32Array) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (pipe as any)(audio, { return_timestamps: false });
          const text = typeof result === "object" && result && "text" in result
            ? String((result as { text?: string }).text ?? "")
            : "";
          return { text: text.trim() };
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "local STT failed to load";
        activeProgressCb?.({ status: "error", message });
        // Reset so the next call can retry from scratch
        pipelinePromise = null;
        throw err;
      }
    })();
  }

  return pipelinePromise;
}

/**
 * Decode a recorded audio Blob (WebM/Ogg/etc.) into a mono Float32Array
 * sampled at 16kHz — what Whisper expects. Browsers record at the device's
 * native rate (typically 48kHz) so we run it through OfflineAudioContext for
 * the mixdown + resample.
 */
export async function blobToFloat32Mono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) throw new Error("AudioContext not supported in this environment");

  // Decoding with an AudioContext we then close — this is the safe pattern
  // for one-off decodes. We pass a sliced ArrayBuffer because decodeAudioData
  // transfers ownership of the buffer.
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));

    // Fast path — already mono and 16k
    if (decoded.sampleRate === 16000 && decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0).slice();
    }

    // Resample + mixdown via OfflineAudioContext. Length is rounded up so we
    // don't truncate the trailing sample.
    const targetLength = Math.max(1, Math.ceil(decoded.duration * 16000));
    const offline = new OfflineAudioContext(1, targetLength, 16000);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    // .slice() detaches from the AudioBuffer so subsequent GC of the buffer
    // doesn't invalidate the data we pass to Whisper.
    return rendered.getChannelData(0).slice();
  } finally {
    try { await ctx.close(); } catch { /* ignore */ }
  }
}
