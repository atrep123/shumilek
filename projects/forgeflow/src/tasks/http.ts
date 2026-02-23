import { ExecutionContext } from '../runner/context';
import { PipelineTask } from '../runner/types';

export async function runHttpRequest(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const url = typeof inputs.url === 'string' ? inputs.url : '';
  if (!url) {
    throw new Error('http.request requires a url');
  }
  const method = typeof inputs.method === 'string' ? inputs.method.toUpperCase() : 'GET';
  const headers = typeof inputs.headers === 'object' && inputs.headers !== null
    ? (inputs.headers as Record<string, string>)
    : {};
  const timeoutMs = typeof inputs.timeoutMs === 'number' && inputs.timeoutMs > 0
    ? Math.floor(inputs.timeoutMs)
    : 10000;
  const responseType = typeof inputs.responseType === 'string' ? inputs.responseType : 'text';

  let body: string | undefined;
  if (typeof inputs.body === 'string') {
    body = inputs.body;
  } else if (inputs.body && typeof inputs.body === 'object') {
    body = JSON.stringify(inputs.body);
    headers['content-type'] = headers['content-type'] || 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });

    let payload: unknown = null;
    if (responseType === 'json') {
      payload = await response.json();
    } else {
      payload = await response.text();
    }

    const headerObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headerObj[key] = value;
    });

    return {
      status: response.status,
      ok: response.ok,
      headers: headerObj,
      body: payload
    };
  } finally {
    clearTimeout(timer);
  }
}
