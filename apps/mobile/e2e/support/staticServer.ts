/** Servidor estático mínimo para o build web (SPA): arquivo se existir, senão `index.html`. */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export interface StaticServer {
  close(): Promise<void>;
}

export async function startStaticServer(root: string, port: number): Promise<StaticServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        // Nada fora de `root`: normaliza e confere o prefixo antes de tocar no disco.
        const candidate = normalize(join(root, pathname));
        const inside = candidate === root || candidate.startsWith(root + sep);
        const file = inside && (await isFile(candidate)) ? candidate : join(root, 'index.html');
        const body = await readFile(file);
        res.writeHead(200, {
          'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } catch {
        res.writeHead(500).end();
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
