export type CappedTextRead = { ok: true; text: string } | { ok: false } | { aborted: true };

type Cancelable = { cancel(reason?: unknown): Promise<void> };

export function cancelReadable(readable: Cancelable | null, reason?: unknown): void {
  if (readable === null) return;
  try {
    void readable.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best-effort after the caller has already stopped waiting.
  }
}

export function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => T,
): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) {
    void promise.catch(() => undefined);
    try {
      return Promise.resolve(onAbort());
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return new Promise((resolve, reject) => {
    const dispose = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      dispose();
      try {
        resolve(onAbort());
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        dispose();
        resolve(value);
      },
      (error) => {
        dispose();
        reject(error);
      },
    );
  });
}

export async function readCappedUtf8Stream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  declaredBytes?: number,
  signal?: AbortSignal,
): Promise<CappedTextRead> {
  if (declaredBytes !== undefined && declaredBytes > maxBytes) {
    cancelReadable(stream);
    return { ok: false };
  }
  if (stream === null) return { ok: true, text: "" };

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await raceAbort<
        { aborted: false; chunk: Awaited<ReturnType<typeof reader.read>> } | { aborted: true }
      >(
        reader.read().then((chunk) => ({ aborted: false as const, chunk })),
        signal,
        () => ({ aborted: true as const }),
      );
      if (next.aborted) {
        cancelReadable(reader, signal?.reason);
        return { aborted: true };
      }
      const { chunk } = next;
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        cancelReadable(reader);
        return { ok: false };
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join("") };
  } finally {
    reader.releaseLock();
  }
}
