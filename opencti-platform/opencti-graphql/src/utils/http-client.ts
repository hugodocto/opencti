import { Readable } from 'node:stream';
import { getPlatformHttpProxyAgent } from '../config/conf';
import { fromBase64, isNotEmptyField } from '../database/utils';

// Drop-in replacement for AxiosHeaders — a plain mutable record used by consumers.
export class OpenCTIHeaders {
  [key: string]: string | undefined;
}

export class HttpClientError extends Error {
  status: number;
  responseData: any;
  headers: Record<string, string>;

  constructor(message: string, status: number, responseData: any = null, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'HttpClientError';
    this.status = status;
    this.responseData = responseData;
    this.headers = headers;
  }
}

export interface Certificates {
  cert: string;
  key: string;
  ca: string;
}
export interface GetHttpClient {
  baseURL?: string;
  rejectUnauthorized?: boolean;
  responseType: 'json' | 'arraybuffer' | 'text' | 'stream';
  headers?: Record<string, string | undefined>;
  certificates?: Certificates;
  auth?: {
    username: string;
    password: string;
  };
}

export interface HttpClientCallConfig {
  url: string;
  method?: string;
  params?: Record<string, string>;
  data?: any;
}

const headersToRecord = (fetchHeaders: Headers): Record<string, string> => {
  const result: Record<string, string> = {};
  fetchHeaders.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

const buildDispatcher = (uri: string, baseURL: string | undefined) => {
  const agentUri = baseURL ? `${baseURL}${uri}` : uri;
  return getPlatformHttpProxyAgent(agentUri, true) ?? undefined;
};

const buildTlsOptions = (rejectUnauthorized: boolean | undefined, certificates: Certificates | undefined) => {
  const cert = isNotEmptyField(certificates?.cert) ? fromBase64(certificates?.cert) : undefined;
  const key = isNotEmptyField(certificates?.key) ? fromBase64(certificates?.key) : undefined;
  const ca = isNotEmptyField(certificates?.ca) ? fromBase64(certificates?.ca) : undefined;
  return { cert, key, ca, rejectUnauthorized: rejectUnauthorized === true };
};

const parseResponseBody = async (response: Response, responseType: string) => {
  switch (responseType) {
    case 'json':
      return response.json();
    case 'arraybuffer':
      return Buffer.from(await response.arrayBuffer());
    case 'text':
      return response.text();
    case 'stream':
      // Return a Node.js Readable stream from the web ReadableStream
      return response.body ? Readable.fromWeb(response.body as any) : Readable.from([]);
    default:
      return response.text();
  }
};

export const getHttpClient = ({ baseURL, headers, rejectUnauthorized, responseType, certificates, auth }: GetHttpClient) => {
  // Build default TLS options (used when no proxy overrides the agent)
  const _tlsOpts = buildTlsOptions(rejectUnauthorized, certificates);

  // For non-fetch callers that still need raw http/https agents (e.g. tests)
  // we keep these around so buildDispatcher can fall back to defaults.
  // Node.js native fetch uses the `dispatcher` option (undici) for proxy support.

  // Merge auth into headers if provided
  const baseHeaders: Record<string, string> = {};
  if (headers) {
    Object.entries(headers).forEach(([k, v]) => {
      if (v !== undefined) baseHeaders[k] = v;
    });
  }
  if (auth) {
    baseHeaders.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
  }

  const resolveUrl = (url: string) => {
    if (baseURL && !url.startsWith('http://') && !url.startsWith('https://')) {
      return `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
    }
    return url;
  };

  const executeFetch = async (url: string, init: RequestInit & { dispatcher?: any } = {}): Promise<{ data: any; status: number; headers: Record<string, string> }> => {
    const fullUrl = resolveUrl(url);
    const dispatcher = buildDispatcher(url, baseURL) ?? init.dispatcher;
    const fetchOpts: any = { ...init, dispatcher };
    const response = await fetch(fullUrl, fetchOpts);
    const responseHeaders = headersToRecord(response.headers);
    if (!response.ok) {
      let errorData: any = null;
      try {
        errorData = await response.text();
        try {
          errorData = JSON.parse(errorData);
        } catch {
          // keep as text
        }
      } catch { /* ignore */ }
      throw new HttpClientError(
        `Request failed with status ${response.status}`,
        response.status,
        errorData,
        responseHeaders,
      );
    }
    const data = await parseResponseBody(response, responseType);
    return { data, status: response.status, headers: responseHeaders };
  };

  return {
    call: async (config: HttpClientCallConfig) => {
      const { url, method = 'GET', params, data } = config;
      const queryString = params ? `?${new URLSearchParams(params).toString()}` : '';
      const fullUrl = `${url}${queryString}`;
      const init: RequestInit & { dispatcher?: any } = {
        method: method.toUpperCase(),
        headers: { ...baseHeaders },
      };
      if (data !== undefined && data !== null) {
        init.body = typeof data === 'string' ? data : JSON.stringify(data);
        if (!(init.headers as Record<string, string>)['Content-Type']) {
          (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
        }
      }
      return executeFetch(fullUrl, init);
    },
    get: async (url: string, opts: any = {}) => {
      const { headers: extraHeaders, params, ...rest } = opts;
      const queryString = params ? `?${new URLSearchParams(params).toString()}` : '';
      const init: RequestInit & { dispatcher?: any } = {
        method: 'GET',
        headers: { ...baseHeaders, ...extraHeaders },
        ...rest,
      };
      return executeFetch(`${url}${queryString}`, init);
    },
    post: async (url: string, data: object, opts: any = {}) => {
      const init: RequestInit & { dispatcher?: any } = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...baseHeaders, ...opts.headers },
        body: JSON.stringify(data),
      };
      return executeFetch(url, init);
    },
    delete: async (url: string, opts: any = {}) => {
      const init: RequestInit & { dispatcher?: any } = {
        method: 'DELETE',
        headers: { ...baseHeaders, ...opts.headers },
      };
      return executeFetch(url, init);
    },
    head: async (url: string, opts: any = {}) => {
      const init: RequestInit & { dispatcher?: any } = {
        method: 'HEAD',
        headers: { ...baseHeaders, ...opts.headers },
      };
      return executeFetch(url, init);
    },
  };
};
