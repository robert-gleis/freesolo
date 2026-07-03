import fs from 'node:fs/promises';

/** How many trailing lines of a check log to keep when summarizing into a prompt. */
export const LOG_TAIL_LINES = 40;
/** Hard cap on the summarized tail so a huge log cannot blow up the prompt. */
export const LOG_TAIL_MAX_CHARS = 4000;
/**
 * Upper bound on bytes ever read from disk for a tail. Set well above
 * LOG_TAIL_MAX_CHARS so multi-byte UTF-8 and the line filter still have room,
 * but low enough that a runaway multi-hundred-MB/GB log can never be slurped
 * into memory. This is the memory guard: we seek to the file's tail rather than
 * reading the whole file.
 */
export const LOG_TAIL_READ_BYTES = 64 * 1024;

/**
 * Reads only the trailing portion of a log file (never the whole file) and
 * returns a bounded tail: at most {@link LOG_TAIL_LINES} lines and at most
 * {@link LOG_TAIL_MAX_CHARS} characters. A missing/unreadable file yields ''.
 *
 * The bounded on-disk read is the point: an earlier check that streamed a
 * runaway log to disk (runShellCheck has no byte cap) must not be slurped
 * entirely into memory when a later agent-review or fixer step summarizes it.
 */
export async function readLogTail(logPath: string): Promise<string> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(logPath, 'r');
    const { size } = await handle.stat();
    const start = size > LOG_TAIL_READ_BYTES ? size - LOG_TAIL_READ_BYTES : 0;
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return capTail(buffer.toString('utf8'));
  } catch {
    return '';
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
}

/** Applies the line/char caps to an already-read chunk of log text. */
export function capTail(content: string): string {
  const lines = content.split('\n');
  const tail = lines.slice(-LOG_TAIL_LINES).join('\n').trim();
  return tail.length > LOG_TAIL_MAX_CHARS ? tail.slice(-LOG_TAIL_MAX_CHARS) : tail;
}
