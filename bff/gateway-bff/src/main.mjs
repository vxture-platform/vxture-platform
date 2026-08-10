import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.env.GATEWAY_PORT ?? 8000);
const WEBSITE_BFF_ORIGIN = (process.env.WEBSITE_BFF_ORIGIN ?? 'http://localhost:3001').replace(/\/+$/, '');
const CONSOLE_BFF_ORIGIN = (process.env.CONSOLE_BFF_ORIGIN ?? 'http://localhost:3021').replace(/\/+$/, '');
const ADMIN_BFF_ORIGIN = (process.env.ADMIN_BFF_ORIGIN ?? 'http://localhost:3043').replace(/\/+$/, '');
const AUTH_BFF_ORIGIN = (process.env.AUTH_BFF_ORIGIN ?? 'http://localhost:3061').replace(/\/+$/, '');
const ALLOWED_ORIGINS = new Set(
  (process.env.GATEWAY_ALLOWED_ORIGINS ??
    'http://localhost:3000,http://localhost:3020,http://localhost:3030,http://127.0.0.1:3000,http://127.0.0.1:3020,http://127.0.0.1:3030')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

function writeCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
}

function mapTarget(pathname) {
  if (pathname.startsWith('/website-api/')) {
    return {
      targetOrigin: WEBSITE_BFF_ORIGIN,
      targetPath: pathname.replace(/^\/website-api/, ''),
    };
  }

  if (pathname === '/website-api') {
    return {
      targetOrigin: WEBSITE_BFF_ORIGIN,
      targetPath: '/',
    };
  }

  if (pathname.startsWith('/console-api/')) {
    return {
      targetOrigin: CONSOLE_BFF_ORIGIN,
      targetPath: pathname.replace(/^\/console-api/, ''),
    };
  }

  if (pathname === '/console-api') {
    return {
      targetOrigin: CONSOLE_BFF_ORIGIN,
      targetPath: '/',
    };
  }

    if (pathname.startsWith('/admin-api/')) {
    return {
      targetOrigin: ADMIN_BFF_ORIGIN,
      targetPath: pathname.replace(/^\/admin-api/, ''),
    };
  }

  if (pathname === '/admin-api') {
    return {
      targetOrigin: ADMIN_BFF_ORIGIN,
      targetPath: '/',
    };
  }

  if (pathname.startsWith('/auth-api/')) {
    return {
      targetOrigin: AUTH_BFF_ORIGIN,
      targetPath: pathname.replace(/^\/auth-api/, ''),
    };
  }

  if (pathname === '/auth-api') {
    return {
      targetOrigin: AUTH_BFF_ORIGIN,
      targetPath: '/',
    };
  }

  return null;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const { pathname, search } = parsed;
  const origin = req.headers.origin;

  writeCors(res, origin);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/healthz') {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(
      JSON.stringify({
          status: 'ok',
          service: 'gateway-bff',
          website: WEBSITE_BFF_ORIGIN,
          console: CONSOLE_BFF_ORIGIN,
          admin: ADMIN_BFF_ORIGIN,
          auth: AUTH_BFF_ORIGIN,
        }),
    );
    return;
  }

  const target = mapTarget(pathname);
  if (!target) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(JSON.stringify({ message: 'Gateway route not found' }));
    return;
  }

  const targetUrl = `${target.targetOrigin}${target.targetPath}${search}`;
  const outgoingHeaders = new Headers();
  Object.entries(req.headers).forEach(([key, value]) => {
    if (!value) {
      return;
    }
    if (key === 'host' || key === 'connection' || key === 'content-length') {
      return;
    }

    if (Array.isArray(value)) {
      outgoingHeaders.set(key, value.join(', '));
      return;
    }

    outgoingHeaders.set(key, value);
  });

  const outgoingBody =
    method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : await readRequestBody(req);

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers: outgoingHeaders,
      body: outgoingBody,
      redirect: 'manual',
    });

    const setCookieHeaders =
      typeof upstreamResponse.headers.getSetCookie === 'function' ? upstreamResponse.headers.getSetCookie() : [];

    upstreamResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        return;
      }
      res.setHeader(key, value);
    });

    if (setCookieHeaders.length > 0) {
      res.setHeader('set-cookie', setCookieHeaders);
    }

    writeCors(res, origin);
    res.writeHead(upstreamResponse.status);

    if (upstreamResponse.body) {
      Readable.fromWeb(upstreamResponse.body).pipe(res);
      return;
    }

    res.end();
  } catch {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(502);
    res.end(JSON.stringify({ message: 'Gateway proxy failed' }));
  }
});

server.listen(PORT, () => {
  console.log(`[gateway-bff] listening on http://localhost:${PORT}`);
    console.log(`[gateway-bff] website-api -> ${WEBSITE_BFF_ORIGIN}`);
  console.log(`[gateway-bff] console-api -> ${CONSOLE_BFF_ORIGIN}`);
  console.log(`[gateway-bff] admin-api -> ${ADMIN_BFF_ORIGIN}`);
  console.log(`[gateway-bff] auth-api -> ${AUTH_BFF_ORIGIN}`);
});
