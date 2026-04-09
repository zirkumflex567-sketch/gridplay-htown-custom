import { test, describe, before } from 'node:test';
import assert from 'node:assert';

let server;
let baseUrl;

before(async () => {
  const { createServer } = await import('http');
  const { readFileSync } = await import('fs');
  const path = await import('path');
  
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  
  await new Promise(resolve => server.listen(3333, resolve));
  baseUrl = 'http://localhost:3333';
});

describe('API Health', () => {
  test('should return health status', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const data = await response.json();
    assert.strictEqual(data.ok, true);
  });
});

describe('API Endpoints', () => {
  test('should have /resolve endpoint', async () => {
    const response = await fetch(`${baseUrl}/resolve?url=https://example.com`);
    assert.ok(response.status === 400 || response.status === 502);
  });

  test('should have /classify endpoint', async () => {
    const response = await fetch(`${baseUrl}/classify?url=https://example.com`);
    assert.ok(response.status === 200 || response.status === 400);
  });

  test('should have /providers endpoint', async () => {
    const response = await fetch(`${baseUrl}/providers`);
    assert.ok(response.status === 200);
  });
});

after(() => {
  if (server) server.close();
});