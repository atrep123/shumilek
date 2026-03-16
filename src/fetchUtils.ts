import fetch, { Response } from 'node-fetch';

export interface FetchOptions {
  method?: string;
  headers?: import('node-fetch').Headers | Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export async function fetchWithTimeout(
  url: string,
  options: FetchOptions,
  timeout: number
): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;

  const originalSignal = options.signal as AbortSignal | undefined;

  // Forward caller aborts into our controller and clean up timeout
  const abortHandler = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (originalSignal) {
    if (originalSignal.aborted) {
      abortHandler();
    } else {
      originalSignal.addEventListener('abort', abortHandler);
    }
  }

  try {
    timeoutId = setTimeout(abortHandler, timeout);

    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (originalSignal) {
      originalSignal.removeEventListener('abort', abortHandler);
    }
  }
}
