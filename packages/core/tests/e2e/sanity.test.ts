import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runCli } from '../helpers/cli-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('E2E Test Harness Sanity Check', () => {
  it('should have environment isolation configured', () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH;
    expect(storePath).toBeDefined();
    expect(fs.existsSync(storePath!)).toBe(true);
    expect(fs.readdirSync(storePath!)).toHaveLength(0);
    expect(process.env.HOME).toBe(storePath);
    expect(process.env.USERPROFILE).toBe(storePath);
  });

  it('should successfully run a mock script using runCli to verify execution', async () => {
    const distDir = path.resolve(__dirname, '../../dist');
    const mockCliFile = path.resolve(distDir, 'cli-mock.js');
    
    const originalDistExists = fs.existsSync(distDir);
    
    if (!originalDistExists) {
      fs.mkdirSync(distDir, { recursive: true });
    }
    
    // Write a small script that outputs its arguments, env variables, and exits
    const testScriptContent = `
      console.log("HELLO_CLI");
      console.log("ARGS:" + JSON.stringify(process.argv.slice(2)));
      console.log("STORE_PATH:" + process.env.SKILLSMAP_STORE_PATH);
    `;
    fs.writeFileSync(mockCliFile, testScriptContent);

    try {
      const result = await runCli(['arg1', 'arg2'], { cliPath: mockCliFile });
      expect(result.stdout).toContain('HELLO_CLI');
      expect(result.stdout).toContain('ARGS:["arg1","arg2"]');
      expect(result.stdout).toContain(`STORE_PATH:${process.env.SKILLSMAP_STORE_PATH}`);
      expect(result.exitCode).toBe(0);
    } finally {
      // Clean up the dummy cli-mock.js
      if (fs.existsSync(mockCliFile)) {
        fs.unlinkSync(mockCliFile);
      }
      // Clean up the dist dir if it was created and is empty
      if (fs.existsSync(distDir) && fs.readdirSync(distDir).length === 0) {
        fs.rmdirSync(distDir);
      }
    }
  });

  it('should successfully run the actual compiled CLI to get the version', async () => {
    const result = await runCli(['--version']);
    expect(result.stdout.trim()).toBe('0.1.0');
    expect(result.exitCode).toBe(0);
  });
});
