/**
 * Dev / preview middleware: POST /api/horizons is handled HERE (Node),
 * not in the browser. The handler talks to NASA. Open URL proxy is rejected.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { handleHorizonsPost } from './src/physics/ephemeris/horizonsApi.server.ts';

const MAX_BODY = 64 * 1024;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isHorizonsPath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  return path === '/api/horizons' || path === '/api/horizons/';
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'POST only' }));
    return;
  }
  try {
    const raw = await readJsonBody(req);
    const result = await handleHorizonsPost(raw);
    res.statusCode = result.status;
    res.end(JSON.stringify(result.body));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Horizons proxy error';
    res.statusCode = /too large|invalid JSON/i.test(message) ? 400 : 502;
    res.end(JSON.stringify({ error: message }));
  }
}

export function horizonsProxyPlugin(): Plugin {
  return {
    name: 'horizons-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isHorizonsPath(req.url)) {
          next();
          return;
        }
        void handle(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isHorizonsPath(req.url)) {
          next();
          return;
        }
        void handle(req, res);
      });
    },
  };
}
