import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as index from '../../src/index';
import { execSync } from 'child_process';

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return {
    ...original,
    execFile: (...args: any[]) => {
      const file = args[0];
      const cmdArgs = args[1];
      const gitUrl = cmdArgs?.[3];
      if (file === 'git' && cmdArgs?.[0] === 'clone' && gitUrl && (gitUrl.startsWith('https://') || gitUrl.startsWith('git@'))) {
        const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
        if (callback) {
          process.nextTick(() => {
            callback(new Error('Git clone failed (mocked)'), '', 'Repository not found');
          });
        }
        return {} as any;
      }
      return (original as any).execFile(...args);
    }
  };
});

describe('CLI Commands In-Process Tests', () => {
  let tempStoreDir: string;
  let originalEnv: Record<string, string | undefined> = {};
  let originalArgv: string[] = [];
  let originalExit: (code?: number) => never;
  let logs: string[] = [];
  let errors: string[] = [];

  let lastExitCode: number | null = null;

  beforeEach(() => {
    const tmpBaseStore = path.join(os.tmpdir(), 'skillsmap-cli-store-');
    tempStoreDir = fs.mkdtempSync(tmpBaseStore);

    originalEnv = {
      SKILLSMAP_STORE_PATH: process.env.SKILLSMAP_STORE_PATH,
    };
    process.env.SKILLSMAP_STORE_PATH = tempStoreDir;

    originalArgv = process.argv;
    originalExit = process.exit;

    lastExitCode = null;
    process.exit = ((code?: number) => {
      lastExitCode = code ?? 1;
    }) as any;

    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = originalArgv;
    process.exit = originalExit;

    if (fs.existsSync(tempStoreDir)) {
      fs.rmSync(tempStoreDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    for (const key of ['SKILLSMAP_STORE_PATH']) {
      const val = originalEnv[key];
      if (val !== undefined) {
        process.env[key] = val;
      } else {
        delete process.env[key];
      }
    }
  });

  async function runCli(args: string[]) {
    lastExitCode = null;
    // commander expects [node, script, ...args]
    process.argv = ['node', 'skillsmap', ...args];
    // Reset modules to clear import cache for cli.ts
    vi.resetModules();
    const cli = await import('../../src/cli');
    await cli.parsePromise;
  }

  it('should verify index exports are correct', () => {
    expect(index.Router).toBeDefined();
    expect(index.Installer).toBeDefined();
    expect(index.RegistryManager).toBeDefined();
  });

  it('should run validate command successfully on empty config', async () => {
    const configPath = path.join(tempStoreDir, 'skillsmap.json');
    fs.writeFileSync(configPath, JSON.stringify({ skills: [] }), 'utf8');

    await runCli(['validate', '-c', configPath]);
    expect(logs.join('\n')).toContain('SkillsMap configuration is valid');
    expect(lastExitCode).toBeNull();
  });

  it('should run validate command with error on invalid config', async () => {
    const configPath = path.join(tempStoreDir, 'skillsmap.json');
    fs.writeFileSync(configPath, JSON.stringify({ skills: [{ id: 'A', name: 'A' }] }), 'utf8'); // missing description, path etc

    await runCli(['validate', '-c', configPath]);
    expect(lastExitCode).toBe(11);
  });

  it('should run list command with JSON and text format options', async () => {
    // Write registry.json
    fs.mkdirSync(path.join(tempStoreDir, 'skills'), { recursive: true });
    const registry = {
      skills: {
        'test-skill': {
          source: 'local',
          localPath: tempStoreDir,
          version: '1.0.0',
          installedAt: '2026-06-07T12:00:00Z'
        }
      }
    };
    fs.writeFileSync(path.join(tempStoreDir, 'registry.json'), JSON.stringify(registry), 'utf8');

    // Write skill.json in the mock local directory (tempStoreDir)
    const skillJson = {
      id: 'test-skill',
      name: 'Test Skill Name',
      description: 'A mock skill description',
      path: './index.js',
      tags: ['test'],
      domain: 'testing'
    };
    fs.writeFileSync(path.join(tempStoreDir, 'skill.json'), JSON.stringify(skillJson), 'utf8');

    // Test text format
    await runCli(['list', '--format', 'text']);
    expect(logs.join('\n')).toContain('test-skill');

    // Reset logs
    logs = [];
    // Test JSON format
    await runCli(['list', '--format', 'json']);
    const listRes = JSON.parse(logs.join('\n'));
    expect(listRes).toHaveLength(1);
    expect(listRes[0].id).toBe('test-skill');
  });

  it('should run route command successfully', async () => {
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

    // JSON format output
    await runCli(['route', 'test query', '-c', configPath, '--format', 'json']);
    const routeRes = JSON.parse(logs.join('\n'));
    expect(routeRes.status).toBe('success');
    expect(routeRes.match.id).toBe('test-skill');

    // Text format output
    logs = [];
    await runCli(['route', 'test query', '-c', configPath, '--format', 'text']);
    expect(logs.join('\n')).toContain('Match Found: test-skill');

    // No match (json)
    logs = [];
    await runCli(['route', 'different query', '-c', configPath, '--format', 'json']);
    expect(lastExitCode).toBe(1);
    const noMatchRes = JSON.parse(logs.join('\n'));
    expect(noMatchRes.status).toBe('no_match');

    // No match (text)
    logs = [];
    await runCli(['route', 'different query', '-c', configPath, '--format', 'text']);
    expect(lastExitCode).toBe(1);
    expect(logs.join('\n')).toContain('No match found.');
  });

  it('should rebuild skillsmap and index successfully', async () => {
    // Write dummy registry
    fs.mkdirSync(path.join(tempStoreDir, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(tempStoreDir, 'registry.json'), JSON.stringify({ skills: {} }), 'utf8');

    await runCli(['rebuild']);
    expect(logs.join('\n')).toContain('Successfully rebuilt skillsmap and index');

    logs = [];
    // Delete index to force a non-forced rebuild
    fs.unlinkSync(path.join(tempStoreDir, 'skillsmap.index.json'));
    await runCli(['index']);
    expect(logs.join('\n')).toContain('Successfully rebuilt index');

    logs = [];
    // Already up to date now
    await runCli(['index']);
    expect(logs.join('\n')).toContain('Index is up to date.');

    logs = [];
    await runCli(['index', '--rebuild']);
    expect(logs.join('\n')).toContain('Successfully rebuilt index (forced)');

    logs = [];
    const customConfigDir = path.join(tempStoreDir, 'custom-dir');
    fs.mkdirSync(customConfigDir, { recursive: true });
    const configPath = path.join(customConfigDir, 'skillsmap.json');
    fs.writeFileSync(configPath, JSON.stringify({ skills: [] }), 'utf8');
    // For custom config: the index file doesn't exist yet, so it should rebuild
    await runCli(['index', '-c', configPath]);
    expect(logs.join('\n')).toContain('Successfully rebuilt index');

    logs = [];
    // Run it again: it should be up to date
    await runCli(['index', '-c', configPath]);
    expect(logs.join('\n')).toContain('Index is up to date.');
  });

  it('should run install, register, and uninstall commands and handle errors', async () => {
    // Install failure (invalid git URL)
    await runCli(['install', 'https://github.com/invalid/non-existent-repo-url-test']);
    expect(lastExitCode).toBe(20);

    // Register failure (invalid path)
    await runCli(['register', './non-existent-local-path-test']);
    expect(lastExitCode).toBe(21);

    // Uninstall failure (non-existent skill ID)
    await runCli(['uninstall', 'non-existent-skill-id-test']);
    expect(lastExitCode).toBe(22);
  });

  it('should run install, register, and uninstall commands successfully', async () => {
    // Setup a mock local git repo for installing
    const mockGitRepoDir = path.join(tempStoreDir, 'mock-git-repo');
    fs.mkdirSync(mockGitRepoDir);
    execSync('git init', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.name "Tester"', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.email "tester@test.com"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    const gitSkillJson = {
      id: 'cli-git-skill',
      name: 'CLI Git Skill',
      description: 'Git skill for CLI tests',
      path: './main.js',
      tags: [],
      domain: 'test',
      category: 'test',
      version: '1.0.0'
    };
    fs.writeFileSync(path.join(mockGitRepoDir, 'skill.json'), JSON.stringify(gitSkillJson), 'utf8');
    fs.writeFileSync(path.join(mockGitRepoDir, 'main.js'), 'console.log("git");', 'utf8');
    execSync('git add .', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    // 1. Install success
    logs = [];
    await runCli(['install', mockGitRepoDir]);
    expect(logs.join('\n')).toContain('Successfully installed skill from:');
    expect(lastExitCode).toBeNull();

    // 2. Register success
    const mockLocalDir = path.join(tempStoreDir, 'mock-local-skill');
    fs.mkdirSync(mockLocalDir);
    const localSkillJson = {
      id: 'cli-local-skill',
      name: 'CLI Local Skill',
      description: 'Local skill for CLI tests',
      path: './index.js',
      tags: [],
      domain: 'test',
      category: 'test',
      version: '1.0.0'
    };
    fs.writeFileSync(path.join(mockLocalDir, 'skill.json'), JSON.stringify(localSkillJson), 'utf8');
    fs.writeFileSync(path.join(mockLocalDir, 'index.js'), 'console.log("local");', 'utf8');

    logs = [];
    await runCli(['register', mockLocalDir]);
    expect(logs.join('\n')).toContain('Successfully registered local skill from:');
    expect(lastExitCode).toBeNull();

    // 3. Uninstall success
    logs = [];
    await runCli(['uninstall', 'cli-local-skill']);
    expect(logs.join('\n')).toContain('Successfully uninstalled skill: cli-local-skill');
    expect(lastExitCode).toBeNull();
  });

  it('should initialize a template config file successfully and throw on duplicate', async () => {
    const customConfigPath = path.join(tempStoreDir, 'custom-skillsmap.json');

    // 1. Success path
    logs = [];
    await runCli(['init', '-c', customConfigPath]);
    expect(logs.join('\n')).toContain('Successfully initialized configuration at:');
    expect(fs.existsSync(customConfigPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(customConfigPath, 'utf8'));
    expect(parsed.$schema).toContain('skillsmap.schema.json');
    expect(parsed.fallbackNodeId).toBe('default-fallback');
    expect(parsed.domains.coding).toContain('refactor');

    // 2. Duplicate error path
    lastExitCode = null;
    errors = [];
    await runCli(['init', '-c', customConfigPath]);
    expect(lastExitCode).toBe(11);
    expect(errors.join('\n')).toContain('Configuration file already exists');
  });
});
