/**
 * Wraps a promise with a timeout. Rejects with TimeoutError if not resolved in time.
 */
export class TimeoutError extends Error {
  constructor(label = 'Request') {
    super(`${label} timed out`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(
  promiseOrThenable: Promise<T> | PromiseLike<T>,
  ms: number,
  label = 'Request'
): Promise<T> {
  const promise = Promise.resolve(promiseOrThenable);
  let timer: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => reject(new TimeoutError(label)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}
