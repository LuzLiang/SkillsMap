import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { startDashboardServer } from '../../src/server';

vi.mock('url', async (importOriginal) => {
  const original = await importOriginal<typeof import('url')>();
  return {
    ...original,
    URL: class extends original.URL {
      constructor(url: string, base?: string | original.URL) {
        super(url, base);
        if (url === '/../../outside-sandbox') {
          Object.defineProperty(this, 'pathname', { value: '/../../outside-sandbox' });
        }
      }
    }
  };
});

describe('Dashboard Server Tests', () => {
  let server: http.Server;
  let activePort = 0;
  let tempStoreDir: string;
  let originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    const tmpBaseStore = path.join(os.tmpdir(), 'skillsmap-server-store-');
    tempStoreDir = fs.mkdtempSync(tmpBaseStore);

    originalEnv = {
      SKILLSMAP_STORE_PATH: process.env.SKILLSMAP_STORE_PATH,
    };
    process.env.SKILLSMAP_STORE_PATH = tempStoreDir;

    // Create a dummy config
    const configPath = path.join(tempStoreDir, 'skillsmap.json');
    const skills = [
      {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'Test skill description',
        path: 'index.js',
        tags: ['test'],
        domain: 'testing',
        triggers: {
          keywords: ['test']
        }
      }
    ];
    fs.writeFileSync(configPath, JSON.stringify({ skills }), 'utf8');

    // Start server on random port (0)
    server = startDashboardServer(0, configPath);

    // Wait for the listening event
    await new Promise<void>((resolve) => {
      if (server.listening) {
        resolve();
      } else {
        server.once('listening', resolve);
      }
    });

    const addr = server.address();
    activePort = typeof addr === 'string' || !addr ? 0 : addr.port;
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        if (fs.existsSync(tempStoreDir)) {
          fs.rmSync(tempStoreDir, { recursive: true, force: true });
        }
        // Restore env
        const val = originalEnv['SKILLSMAP_STORE_PATH'];
        if (val !== undefined) {
          process.env['SKILLSMAP_STORE_PATH'] = val;
        } else {
          delete process.env['SKILLSMAP_STORE_PATH'];
        }
        resolve();
      });
    });
  });

  const fetchGet = (urlPath: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> => {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${activePort}${urlPath}`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: data,
            headers: res.headers
          });
        });
      }).on('error', reject);
    });
  };

  it('should return config for local source', async () => {
    const res = await fetchGet('/api/config?source=local');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].id).toBe('test-skill');
  });

  it('should return config for demo source', async () => {
    const res = await fetchGet('/api/config?source=demo');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.skills.length).toBeGreaterThan(0);
    expect(body.skills[0].id).toBe('git-init');
  });

  it('should run routing for local source', async () => {
    const res = await fetchGet('/api/route?prompt=test&source=local');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.match.id).toBe('test-skill');
  });

  it('should run routing for demo source', async () => {
    const res = await fetchGet('/api/route?prompt=git&source=demo');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.match.id).toBe('git-init');
  });

  it('should serve index.html or 404 for non-existent assets gracefully', async () => {
    const res = await fetchGet('/non-existent-page');
    expect([200, 404]).toContain(res.status);
  });

  it('should respond to CORS OPTIONS requests with 200', async () => {
    return new Promise<void>((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: activePort,
        path: '/api/config',
        method: 'OPTIONS'
      }, (res) => {
        expect(res.statusCode).toBe(200);
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  });

  it('should return 403 Forbidden for directory traversal static asset request', async () => {
    const listener = server.listeners('request')[0] as http.RequestListener;
    
    const originalURL = global.URL;
    global.URL = class extends originalURL {
      constructor(url: string, base?: string | URL) {
        super(url, base);
        if (url === '/../../outside-sandbox') {
          Object.defineProperty(this, 'pathname', { value: '/../../outside-sandbox' });
        }
      }
    } as any;

    try {
      const req = {
        url: '/../../outside-sandbox',
        method: 'GET',
        headers: { host: 'localhost' }
      } as any;

      let statusCode = 0;
      let responseBody = '';
      const res = {
        setHeader: () => {},
        writeHead: (code: number) => {
          statusCode = code;
        },
        end: (body: string) => {
          responseBody = body;
        }
      } as any;

      await listener(req, res);

      if (statusCode === 500) {
        console.log('Error from server traversal test:', responseBody);
      }

      expect(statusCode).toBe(403);
      expect(responseBody).toBe('Forbidden');
    } finally {
      global.URL = originalURL;
    }
  });

  it('should return 500 when loading config fails on dynamic endpoints', async () => {
    const configPath = path.join(tempStoreDir, 'skillsmap.json');
    fs.writeFileSync(configPath, '{ corrupted json', 'utf8');

    const res = await fetchGet('/api/config?source=local');
    expect(res.status).toBe(500);
    expect(res.body).toContain('error');
  });

  it('should return 500 when routing fails on dynamic endpoints', async () => {
    const configPath = path.join(tempStoreDir, 'skillsmap.json');
    fs.writeFileSync(configPath, '{ corrupted json', 'utf8');

    const res = await fetchGet('/api/route?prompt=test&source=local');
    expect(res.status).toBe(500);
    expect(res.body).toContain('error');
  });

  it('should return 500 for unhandled internal server error when request parsing throws', async () => {
    return new Promise<void>((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: activePort,
        path: '/api/config',
        headers: {
          'host': '[]'
        }
      }, (res) => {
        expect(res.statusCode).toBe(500);
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  });
});
