import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { Router } from './router';
import { loadConfig } from './config';
import { validateConfig } from './validation';
import { DEMO_SKILLS } from './demo-skills';

/**
 * Starts the telemetry API and cockpit static assets server.
 * Registers a SIGINT handler for graceful termination of the listener socket.
 * @param port The port number to bind the server listener to
 * @param configPath Optional path to the configuration file
 * @returns The active Node HTTP Server instance
 */
export function startDashboardServer(port: number, configPath?: string) {
  // Locate the prebuilt dashboard assets directory
  let distDir = path.resolve(__dirname, '../../dashboard/dist');
  if (!fs.existsSync(distDir)) {
    distDir = path.resolve(__dirname, '../dashboard/dist');
  }
  if (!fs.existsSync(distDir)) {
    distDir = path.resolve(process.cwd(), 'packages/dashboard/dist');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || '', `http://${req.headers.host}`);
      const pathname = parsedUrl.pathname;

      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // API Endpoints
      if (pathname === '/api/config') {
        const source = parsedUrl.searchParams.get('source');
        if (source === 'demo') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            skills: DEMO_SKILLS,
            fallbackNodeId: 'git-init',
            domains: undefined
          }));
          return;
        }

        try {
          await validateConfig(configPath);
          const configData = await loadConfig(configPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(configData));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Failed to load configuration' }));
        }
        return;
      }

      if (pathname === '/api/route') {
        const prompt = parsedUrl.searchParams.get('prompt') || '';
        const topStr = parsedUrl.searchParams.get('top') || '1';
        const verbose = parsedUrl.searchParams.get('verbose') === 'true';
        const source = parsedUrl.searchParams.get('source');
        const top = parseInt(topStr, 10) || 1;

        try {
          let router: Router;
          if (source === 'demo') {
            router = new Router(DEMO_SKILLS, 'git-init', undefined, undefined);
          } else {
            await validateConfig(configPath);
            const { skills, fallbackNodeId, domains } = await loadConfig(configPath);
            router = new Router(skills, fallbackNodeId, domains, configPath);
          }
          const result = await router.route(prompt, { top, verbose, noCache: true });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Routing failed' }));
        }
        return;
      }

      // Serve static assets
      let safePathname = pathname.replace(/^(\.\.[\/\\])+/, '');
      if (safePathname === '/' || safePathname === '') {
        safePathname = '/index.html';
      }

      const filePath = path.join(distDir, safePathname);
      const resolvedFilePath = path.resolve(filePath);
      const resolvedDistDir = path.resolve(distDir);

      if (!resolvedFilePath.startsWith(resolvedDistDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(resolvedFilePath) && fs.statSync(resolvedFilePath).isFile()) {
        const ext = path.extname(resolvedFilePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(resolvedFilePath).pipe(res);
      } else {
        // SPA Fallback to index.html
        const indexHtmlPath = path.join(resolvedDistDir, 'index.html');
        if (fs.existsSync(indexHtmlPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          fs.createReadStream(indexHtmlPath).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      }
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.message}`);
    }
  });

  server.listen(port, () => {
    console.log(`🛸 SkillsMap Cockpit Server running at http://localhost:${port}/`);
    console.log(`   Serving UI assets from: ${distDir}`);
  });

  const sigintHandler = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', sigintHandler);
  server.on('close', () => {
    process.off('SIGINT', sigintHandler);
  });

  return server;
}
