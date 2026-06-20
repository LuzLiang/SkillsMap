import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { pathToFileURL } from 'url';
import { RegistryManager, rebuildSkillsMap } from '../../src/registry';
import { Installer } from '../../src/installer';
import { SkillsMapError } from '../../src/types';

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

describe('SkillsMap Unit Tests', () => {
  let tempStoreDir: string;
  let mockLocalSkillDir: string;
  let mockGitRepoDir: string;
  let originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Create isolated temp store path
    const tmpBaseStore = path.join(os.tmpdir(), 'skillsmap-unit-store-');
    tempStoreDir = fs.mkdtempSync(tmpBaseStore);

    // Create a mock local skill directory
    const tmpBaseLocal = path.join(os.tmpdir(), 'skillsmap-unit-local-');
    mockLocalSkillDir = fs.mkdtempSync(tmpBaseLocal);

    // Create a mock git repository directory
    const tmpBaseGit = path.join(os.tmpdir(), 'skillsmap-unit-git-');
    mockGitRepoDir = fs.mkdtempSync(tmpBaseGit);

    // Back up environment variables
    originalEnv = {
      SKILLSMAP_STORE_PATH: process.env.SKILLSMAP_STORE_PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
    };

    // Extract drive letter and path for HOMEDRIVE / HOMEPATH override
    const driveMatch = tempStoreDir.match(/^([a-zA-Z]:)(.*)$/);
    const homeDrive = driveMatch ? driveMatch[1] : '';
    const homePath = driveMatch ? driveMatch[2] : tempStoreDir;

    // Override env vars with temporary directory to isolate test environment
    process.env.SKILLSMAP_STORE_PATH = tempStoreDir;
    process.env.HOME = tempStoreDir;
    process.env.USERPROFILE = tempStoreDir;
    process.env.HOMEDRIVE = homeDrive;
    process.env.HOMEPATH = homePath;
  });

  afterEach(() => {
    // Clean up all directories
    if (fs.existsSync(tempStoreDir)) {
      fs.rmSync(tempStoreDir, { recursive: true, force: true });
    }
    if (fs.existsSync(mockLocalSkillDir)) {
      fs.rmSync(mockLocalSkillDir, { recursive: true, force: true });
    }
    if (fs.existsSync(mockGitRepoDir)) {
      fs.rmSync(mockGitRepoDir, { recursive: true, force: true });
    }

    // Restore environment variables
    for (const key of ['SKILLSMAP_STORE_PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH']) {
      const val = originalEnv[key];
      if (val !== undefined) {
        process.env[key] = val;
      } else {
        delete process.env[key];
      }
    }
  });

  it('should initialize store directory correctly', async () => {
    const manager = new RegistryManager(tempStoreDir);
    const registry = await manager.load();
    expect(fs.existsSync(path.join(tempStoreDir, 'registry.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempStoreDir, 'skillsmap.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempStoreDir, 'skillsmap.index.json'))).toBe(true);

    expect(registry).toEqual({ skills: {} });
  });

  it('should register a local skill successfully and rebuild indexes', async () => {
    // Write skill.json in mock local skill
    const skillJson = {
      id: 'test-local-skill',
      name: 'Test Local Skill',
      description: 'A mock local skill for testing search capability',
      path: './index.js',
      tags: ['test', 'local'],
      domain: 'testing',
      category: 'unit-test',
      version: '1.2.3'
    };
    fs.writeFileSync(
      path.join(mockLocalSkillDir, 'skill.json'),
      JSON.stringify(skillJson, null, 2),
      'utf8'
    );
    // Write a dummy entrypoint
    fs.writeFileSync(path.join(mockLocalSkillDir, 'index.js'), 'console.log("hello");', 'utf8');

    const installer = new Installer(tempStoreDir);
    await installer.registerLocal(mockLocalSkillDir);

    // Verify registry.json updated
    const registry = await installer['registryManager'].load();
    expect(registry.skills['test-local-skill']).toBeDefined();
    expect(registry.skills['test-local-skill'].source).toBe('local');
    expect(registry.skills['test-local-skill'].localPath).toBe(path.resolve(mockLocalSkillDir));
    expect(registry.skills['test-local-skill'].version).toBe('1.2.3');

    // Verify skillsmap.json contains resolved path
    const mapContent = JSON.parse(fs.readFileSync(path.join(tempStoreDir, 'skillsmap.json'), 'utf8'));
    expect(mapContent).toHaveLength(1);
    expect(mapContent[0].id).toBe('test-local-skill');
    expect(mapContent[0].path).toBe(fs.realpathSync(path.resolve(mockLocalSkillDir, 'index.js')));

    // Verify skillsmap.index.json contains BM25 precomputations
    const indexContent = JSON.parse(fs.readFileSync(path.join(tempStoreDir, 'skillsmap.index.json'), 'utf8'));
    expect(indexContent.docCount).toBe(1);
    expect(indexContent.avgDocLength).toBeGreaterThan(0);
    expect(indexContent.docLengths['test-local-skill']).toBeGreaterThan(0);
    expect(indexContent.terms['mock']).toBeDefined();
  });

  it('should throw error 21 on missing or invalid skill.json when registering local', async () => {
    const installer = new Installer(tempStoreDir);
    await expect(installer.registerLocal(mockLocalSkillDir)).rejects.toThrowError();

    try {
      await installer.registerLocal(mockLocalSkillDir);
    } catch (err: any) {
      expect(err).toBeInstanceOf(SkillsMapError);
      expect(err.exitCode).toBe(21);
    }

    // Now write invalid skill.json (missing id)
    fs.writeFileSync(
      path.join(mockLocalSkillDir, 'skill.json'),
      JSON.stringify({ name: 'no-id', path: './index.js' }),
      'utf8'
    );
    try {
      await installer.registerLocal(mockLocalSkillDir);
    } catch (err: any) {
      expect(err.exitCode).toBe(21);
    }
  });

  it('should install a skill from local git repository offline', async () => {
    // Setup git repo locally
    execSync('git init', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.name "Tester"', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.email "tester@test.com"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    const skillJson = {
      id: 'test-git-skill',
      name: 'Test Git Skill',
      description: 'A mock git skill cloned from a local repository',
      path: './main.js',
      tags: ['git', 'clone'],
      domain: 'testing',
      category: 'unit-test',
      version: '0.9.0'
    };
    fs.writeFileSync(
      path.join(mockGitRepoDir, 'skill.json'),
      JSON.stringify(skillJson, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(mockGitRepoDir, 'main.js'), 'console.log("git");', 'utf8');

    execSync('git add .', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    const installer = new Installer(tempStoreDir);
    await installer.installFromGit(mockGitRepoDir);

    // Verify registry.json updated
    const registry = await installer['registryManager'].load();
    expect(registry.skills['test-git-skill']).toBeDefined();
    expect(registry.skills['test-git-skill'].source).toBe('git');
    expect(registry.skills['test-git-skill'].version).toBe('0.9.0');

    // Verify cloned files exist in store
    const skillStorePath = path.join(tempStoreDir, 'skills', 'test-git-skill');
    expect(fs.existsSync(skillStorePath)).toBe(true);
    expect(fs.existsSync(path.join(skillStorePath, 'skill.json'))).toBe(true);
    expect(fs.existsSync(path.join(skillStorePath, 'main.js'))).toBe(true);

    // Verify skillsmap.json contains resolved path
    const mapContent = JSON.parse(fs.readFileSync(path.join(tempStoreDir, 'skillsmap.json'), 'utf8'));
    expect(mapContent).toHaveLength(1);
    expect(mapContent[0].id).toBe('test-git-skill');
    expect(mapContent[0].path).toBe(fs.realpathSync(path.resolve(skillStorePath, 'main.js')));
  });

  it('should handle errors and clean up temp directory on invalid git configurations', async () => {
    // Setup git repo locally
    execSync('git init', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.name "Tester"', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.email "tester@test.com"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    fs.writeFileSync(path.join(mockGitRepoDir, 'main.js'), 'console.log("git");', 'utf8');
    fs.writeFileSync(path.join(mockGitRepoDir, 'skill.json'), '{}', 'utf8');
    execSync('git add .', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    const installer = new Installer(tempStoreDir);

    // Helper to commit changes to the mock local git repo
    const commitChanges = () => {
      execSync('git add .', { cwd: mockGitRepoDir, stdio: 'ignore' });
      execSync('git commit -m "update configuration"', { cwd: mockGitRepoDir, stdio: 'ignore' });
    };

    // 1. Missing skill.json
    fs.rmSync(path.join(mockGitRepoDir, 'skill.json'));
    execSync('git rm skill.json', { cwd: mockGitRepoDir, stdio: 'ignore' });
    commitChanges();
    await expect(installer.installFromGit(mockGitRepoDir)).rejects.toThrowError();
    try {
      await installer.installFromGit(mockGitRepoDir);
    } catch (err: any) {
      expect(err.exitCode).toBe(21);
    }

    // Restore a corrupted skill.json
    fs.writeFileSync(path.join(mockGitRepoDir, 'skill.json'), '{ corrupted', 'utf8');
    commitChanges();
    try {
      await installer.installFromGit(mockGitRepoDir);
    } catch (err: any) {
      expect(err.exitCode).toBe(10);
    }

    // Restore a valid schema but invalid regex
    const badRegexSkill = {
      id: 'bad-regex-skill',
      name: 'Bad Regex',
      description: 'Skill with bad regex',
      path: './main.js',
      tags: [],
      domain: 'test',
      triggers: { regex: ['[bad-regex'] }
    };
    fs.writeFileSync(path.join(mockGitRepoDir, 'skill.json'), JSON.stringify(badRegexSkill), 'utf8');
    commitChanges();
    try {
      await installer.installFromGit(mockGitRepoDir);
    } catch (err: any) {
      expect(err.exitCode).toBe(11);
    }

    // Complex regex
    const complexRegexSkill = {
      id: 'complex-regex-skill',
      name: 'Complex Regex',
      description: 'Skill with complex regex',
      path: './main.js',
      tags: [],
      domain: 'test',
      triggers: { regex: ['(?=lookahead)'] }
    };
    fs.writeFileSync(path.join(mockGitRepoDir, 'skill.json'), JSON.stringify(complexRegexSkill), 'utf8');
    commitChanges();
    try {
      await installer.installFromGit(mockGitRepoDir);
    } catch (err: any) {
      expect(err.exitCode).toBe(11);
    }
  });

  it('should throw error 20 when git clone fails', async () => {
    const installer = new Installer(tempStoreDir);
    const nonExistentPath = path.join(tempStoreDir, 'non-existent-git-repo');
    
    try {
      await installer.installFromGit(nonExistentPath);
      expect(true).toBe(false); // should not reach here
    } catch (err: any) {
      expect(err).toBeInstanceOf(SkillsMapError);
      expect(err.exitCode).toBe(20);
    }
  });

  it('should test uninstalling non-existent skill', async () => {
    const installer = new Installer(tempStoreDir);

    await expect(installer.uninstall('non-existent-id')).rejects.toThrow('is not installed');
  });

  it('should handle uninstallation and check dependency conflicts (code 22)', async () => {
    // Register skill A (dependency)
    const skillAJson = {
      id: 'skill-a',
      name: 'Skill A',
      description: 'Independent base skill',
      path: './index.js',
      tags: [],
      domain: 'test'
    };
    const localDirA = path.join(mockLocalSkillDir, 'skill-a');
    fs.mkdirSync(localDirA);
    fs.writeFileSync(path.join(localDirA, 'skill.json'), JSON.stringify(skillAJson), 'utf8');
    fs.writeFileSync(path.join(localDirA, 'index.js'), '', 'utf8');

    // Register skill B (depends on A)
    const skillBJson = {
      id: 'skill-b',
      name: 'Skill B',
      description: 'Dependent skill',
      path: './index.js',
      tags: [],
      domain: 'test',
      dependencies: ['skill-a']
    };
    const localDirB = path.join(mockLocalSkillDir, 'skill-b');
    fs.mkdirSync(localDirB);
    fs.writeFileSync(path.join(localDirB, 'skill.json'), JSON.stringify(skillBJson), 'utf8');
    fs.writeFileSync(path.join(localDirB, 'index.js'), '', 'utf8');

    const installer = new Installer(tempStoreDir);
    await installer.registerLocal(localDirA);
    await installer.registerLocal(localDirB);

    // Uninstall B (should succeed since no one depends on B)
    await installer.uninstall('skill-b');
    let registry = await installer['registryManager'].load();
    expect(registry.skills['skill-b']).toBeUndefined();
    expect(registry.skills['skill-a']).toBeDefined();

    // Re-register B to test conflict on uninstalling A
    await installer.registerLocal(localDirB);

    // Try to uninstall A (should fail with code 22 since B depends on A)
    try {
      await installer.uninstall('skill-a');
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(SkillsMapError);
      expect(err.exitCode).toBe(22);
    }

    // Force uninstall A (should succeed)
    await installer.uninstall('skill-a', true);
    registry = await installer['registryManager'].load();
    expect(registry.skills['skill-a']).toBeUndefined();
  });

  it('should list registered skills with domain filtering', async () => {
    const skillAJson = {
      id: 'skill-a',
      name: 'Skill A',
      description: 'Skill in finance domain',
      path: './index.js',
      tags: [],
      domain: 'finance'
    };
    const localDirA = path.join(mockLocalSkillDir, 'skill-a');
    fs.mkdirSync(localDirA);
    fs.writeFileSync(path.join(localDirA, 'skill.json'), JSON.stringify(skillAJson), 'utf8');
    fs.writeFileSync(path.join(localDirA, 'index.js'), '', 'utf8');

    const skillBJson = {
      id: 'skill-b',
      name: 'Skill B',
      description: 'Skill in healthcare domain',
      path: './index.js',
      tags: [],
      domain: 'healthcare'
    };
    const localDirB = path.join(mockLocalSkillDir, 'skill-b');
    fs.mkdirSync(localDirB);
    fs.writeFileSync(path.join(localDirB, 'skill.json'), JSON.stringify(skillBJson), 'utf8');
    fs.writeFileSync(path.join(localDirB, 'index.js'), '', 'utf8');

    const installer = new Installer(tempStoreDir);
    await installer.registerLocal(localDirA);
    await installer.registerLocal(localDirB);

    // List all
    const all = await installer.list('json');
    expect(all).toHaveLength(2);

    // List filtered by finance
    const financeOnly = await installer.list('json', 'finance');
    expect(financeOnly).toHaveLength(1);
    expect(financeOnly[0].id).toBe('skill-a');

    // List filtered by case-insensitive healthcare
    const healthcareOnly = await installer.list('json', 'HealthCare');
    expect(healthcareOnly).toHaveLength(1);
    expect(healthcareOnly[0].id).toBe('skill-b');
  });

  it('should throw an error if registry.json is corrupted', async () => {
    const manager = new RegistryManager(tempStoreDir);
    const registryPath = path.join(tempStoreDir, 'registry.json');
    fs.writeFileSync(registryPath, '{ corrupted json: ', 'utf8');

    await expect(manager.load()).rejects.toThrowError('Failed to parse registry.json (JSON is corrupted)');
    await expect(rebuildSkillsMap(tempStoreDir)).rejects.toThrowError('Failed to parse registry.json in rebuildSkillsMap');
  });

  it('should handle broken symlinks correctly when registering local', async () => {
    // Create a temporary mock local skill
    const skillJson = {
      id: 'broken-symlink-test',
      name: 'Broken Symlink Test',
      description: 'A test for broken symlink handling',
      path: './index.js',
      tags: [],
      domain: 'test'
    };
    fs.writeFileSync(
      path.join(mockLocalSkillDir, 'skill.json'),
      JSON.stringify(skillJson, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(mockLocalSkillDir, 'index.js'), '', 'utf8');

    const installer = new Installer(tempStoreDir);
    await installer.registerLocal(mockLocalSkillDir);

    // Now manually remove the mock local directory to break the symlink
    fs.rmSync(mockLocalSkillDir, { recursive: true, force: true });

    // Since the symlink is broken, fs.existsSync(targetLinkPath) is false.
    // However, the symlink file/junction itself still exists on disk in the skills store.
    // Registering again (or installing) should not crash with EEXIST because it deletes it unconditionally.
    // Let's create a new mock local directory and register it again under the same ID.
    const newMockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsmap-unit-local-new-'));
    try {
      fs.writeFileSync(
        path.join(newMockDir, 'skill.json'),
        JSON.stringify(skillJson, null, 2),
        'utf8'
      );
      fs.writeFileSync(path.join(newMockDir, 'index.js'), '', 'utf8');

      // This should succeed and not throw EEXIST
      await installer.registerLocal(newMockDir);
      
      const registry = await installer['registryManager'].load();
      expect(registry.skills['broken-symlink-test']).toBeDefined();
    } finally {
      fs.rmSync(newMockDir, { recursive: true, force: true });
    }
  });

  it('should print a warning when entrypoint file inside registered path does not exist', async () => {
    const skillJson = {
      id: 'missing-entrypoint-skill',
      name: 'Missing Entrypoint',
      description: 'Skill with missing entrypoint file',
      path: './does-not-exist.js',
      tags: [],
      domain: 'test'
    };
    fs.writeFileSync(
      path.join(mockLocalSkillDir, 'skill.json'),
      JSON.stringify(skillJson, null, 2),
      'utf8'
    );

    // Mock console.warn
    const originalWarn = console.warn;
    let warningMessage = '';
    console.warn = (msg: string) => {
      warningMessage = msg;
    };

    try {
      const installer = new Installer(tempStoreDir);
      await installer.registerLocal(mockLocalSkillDir);

      expect(warningMessage).toContain('Warning: Entrypoint file inside registered path does not exist');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should test RegistryManager edge cases', async () => {
    const manager = new RegistryManager(tempStoreDir);
    expect(await manager.getSkills()).toEqual({});

    // rebuildSkillsMap on missing registry.json does nothing
    const emptyDir = path.join(tempStoreDir, 'empty-dir');
    fs.mkdirSync(emptyDir);
    const emptyManager = new RegistryManager(emptyDir);
    fs.rmSync(path.join(emptyDir, 'registry.json'), { force: true }); // delete registry file
    fs.rmSync(path.join(emptyDir, 'skillsmap.json'), { force: true }); // delete initialized skillsmap
    await emptyManager.rebuildSkillsMap(emptyDir);
    expect(fs.existsSync(path.join(emptyDir, 'skillsmap.json'))).toBe(false);

    // registry has skill but skill directory is missing
    const data = await manager.load();
    data.skills['missing-skill'] = {
      source: 'local',
      localPath: path.join(tempStoreDir, 'non-existent-local-path'),
      version: '1.0.0',
      installedAt: new Date().toISOString()
    };
    await manager.save(data);
    await manager.rebuildSkillsMap();
    let mapContent = JSON.parse(fs.readFileSync(path.join(tempStoreDir, 'skillsmap.json'), 'utf8'));
    expect(mapContent).toHaveLength(0);

    // skill directory exists but skill.json is missing or corrupted
    const skillPath = path.join(tempStoreDir, 'skills', 'missing-skill');
    fs.mkdirSync(skillPath, { recursive: true });
    await manager.rebuildSkillsMap();
    mapContent = JSON.parse(fs.readFileSync(path.join(tempStoreDir, 'skillsmap.json'), 'utf8'));
    expect(mapContent).toHaveLength(0);

    // write corrupted skill.json
    fs.writeFileSync(path.join(skillPath, 'skill.json'), '{ corrupted', 'utf8');
    await manager.rebuildSkillsMap();
    mapContent = JSON.parse(fs.readFileSync(path.join(tempStoreDir, 'skillsmap.json'), 'utf8'));
    expect(mapContent).toHaveLength(0);

    // Test installer list with empty list (text format)
    const installer = new Installer(tempStoreDir);
    // Remove the registered skill first
    const dataEmpty = await manager.load();
    dataEmpty.skills = {};
    await manager.save(dataEmpty);
    await expect(installer.list('text')).resolves.toHaveLength(0);

    // Test installer list with corrupted skill.json
    dataEmpty.skills['corrupted-skill'] = {
      source: 'local',
      localPath: skillPath, // has corrupted skill.json
      version: '1.0.0',
      installedAt: new Date().toISOString()
    };
    await manager.save(dataEmpty);
    await expect(installer.list('json')).resolves.toHaveLength(1); // should still list but with default fields

    // Test installer list with Git source
    dataEmpty.skills['git-skill'] = {
      source: 'git',
      url: 'https://github.com/some/repo',
      version: '1.2.3',
      installedAt: new Date().toISOString()
    };
    await manager.save(dataEmpty);
    // Create git skill directory
    const gitSkillDir = path.join(tempStoreDir, 'skills', 'git-skill');
    fs.mkdirSync(gitSkillDir, { recursive: true });
    fs.writeFileSync(path.join(gitSkillDir, 'skill.json'), JSON.stringify({
      id: 'git-skill',
      name: 'Git Skill',
      description: 'Git sourced skill description',
      path: 'main.js',
      tags: [],
      domain: 'vcs'
    }), 'utf8');
    await expect(installer.list('text')).resolves.toHaveLength(2);

    // Test corrupted registry.json throws in load()
    fs.writeFileSync(path.join(tempStoreDir, 'registry.json'), '{ corrupted', 'utf8');
    await expect(manager.load()).rejects.toThrow('Failed to parse registry.json (JSON is corrupted)');

    // Test corrupted registry.json throws in rebuildSkillsMap()
    await expect(manager.rebuildSkillsMap()).rejects.toThrow('Failed to parse registry.json in rebuildSkillsMap');

    // Test standalone rebuildSkillsMap helper
    fs.writeFileSync(path.join(tempStoreDir, 'registry.json'), JSON.stringify({ skills: {} }), 'utf8');
    await expect(rebuildSkillsMap(tempStoreDir)).resolves.not.toThrow();
  });

  it('should return store directory when calling getTargetDir', () => {
    const installer = new Installer(tempStoreDir);
    expect(installer.getTargetDir()).toBe(tempStoreDir);
  });

  it('should initialize with default store directory when no targetDir is provided', () => {
    const installer = new Installer();
    expect(installer.getTargetDir()).toBeDefined();
  });

  it('should fallback to default version 0.1.0 when installing from git without version', async () => {
    // Setup git repo locally
    execSync('git init', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.name "Tester"', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.email "tester@test.com"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    const skillJson = {
      id: 'test-git-no-version',
      name: 'Test Git No Version',
      description: 'Git skill with no version',
      path: './main.js',
      tags: [],
      domain: 'testing',
      category: 'unit-test'
    };
    fs.writeFileSync(
      path.join(mockGitRepoDir, 'skill.json'),
      JSON.stringify(skillJson, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(mockGitRepoDir, 'main.js'), 'console.log("git");', 'utf8');

    execSync('git add .', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    const installer = new Installer(tempStoreDir);
    await installer.installFromGit(mockGitRepoDir);

    const registry = await installer['registryManager'].load();
    expect(registry.skills['test-git-no-version']).toBeDefined();
    expect(registry.skills['test-git-no-version'].version).toBe('0.1.0');
  });

  it('should check dependency conflicts for non-local (git) source dependents and handle json parse error', async () => {
    // Register base skill-a
    const skillAJson = {
      id: 'skill-a',
      name: 'Skill A',
      description: 'Base skill',
      path: './index.js',
      tags: [],
      domain: 'test'
    };
    const localDirA = path.join(mockLocalSkillDir, 'skill-a-dep');
    fs.mkdirSync(localDirA, { recursive: true });
    fs.writeFileSync(path.join(localDirA, 'skill.json'), JSON.stringify(skillAJson), 'utf8');
    fs.writeFileSync(path.join(localDirA, 'index.js'), '', 'utf8');

    const installer = new Installer(tempStoreDir);
    await installer.registerLocal(localDirA);

    // Mock register a git-sourced dependent skill
    const manager = installer['registryManager'];
    const registry = await manager.load();
    registry.skills['skill-git-dep'] = {
      source: 'git',
      url: 'https://github.com/some/repo',
      version: '1.0.0',
      installedAt: new Date().toISOString()
    };
    await manager.save(registry);

    // Create the git skill directory in store, but with invalid skill.json (parsing error)
    const gitSkillDir = path.join(tempStoreDir, 'skills', 'skill-git-dep');
    fs.mkdirSync(gitSkillDir, { recursive: true });
    fs.writeFileSync(path.join(gitSkillDir, 'skill.json'), '{ corrupted json', 'utf8');

    // Trying to uninstall skill-a should check skill-git-dep, hit parsing error (uncovered line 194-196), ignore it and proceed.
    // Since parsing fails, it doesn't recognize dependency, so it successfully uninstalls skill-a.
    await expect(installer.uninstall('skill-a')).resolves.not.toThrow();

    // Now re-register skill-a
    await installer.registerLocal(localDirA);

    // Write valid skill.json indicating dependency on skill-a
    const gitDepSkillJson = {
      id: 'skill-git-dep',
      name: 'Git Dependent Skill',
      description: 'Git skill depending on A',
      path: './index.js',
      tags: [],
      dependencies: ['skill-a']
    };
    fs.writeFileSync(path.join(gitSkillDir, 'skill.json'), JSON.stringify(gitDepSkillJson), 'utf8');

    // Trying to uninstall skill-a should now throw conflict error
    await expect(installer.uninstall('skill-a')).rejects.toThrow('Dependency conflict');
  });

  it('should ignore errors when fs.rmSync fails during uninstallation', async () => {
    const installer = new Installer(tempStoreDir);
    const manager = installer['registryManager'];
    const registry = await manager.load();
    // Register a skill with a null byte in the ID, which will fail fs.rmSync when trying to resolve target path
    registry.skills['skill-rm-fail\0'] = {
      source: 'local',
      localPath: 'some-path',
      version: '1.0.0',
      installedAt: new Date().toISOString()
    };
    await manager.save(registry);

    await expect(installer.uninstall('skill-rm-fail\0')).resolves.not.toThrow();
  });

  it('should install a skill from local git repository via file:// URL', async () => {
    // Setup git repo locally
    execSync('git init', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.name "Tester"', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git config user.email "tester@test.com"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    const skillJson = {
      id: 'test-git-file-url',
      name: 'Test Git File URL',
      description: 'A mock git skill cloned from a local repository via file URL',
      path: './main.js',
      tags: ['git', 'clone'],
      domain: 'testing',
      category: 'unit-test',
      version: '0.9.0'
    };
    fs.writeFileSync(
      path.join(mockGitRepoDir, 'skill.json'),
      JSON.stringify(skillJson, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(mockGitRepoDir, 'main.js'), 'console.log("git");', 'utf8');

    execSync('git add .', { cwd: mockGitRepoDir, stdio: 'ignore' });
    execSync('git commit -m "initial commit"', { cwd: mockGitRepoDir, stdio: 'ignore' });

    const fileUrl = pathToFileURL(mockGitRepoDir).href;

    const installer = new Installer(tempStoreDir);
    await installer.installFromGit(fileUrl);

    // Verify registry.json updated
    const registry = await installer['registryManager'].load();
    expect(registry.skills['test-git-file-url']).toBeDefined();
  });

  it('should enforce Git URL whitelisting', async () => {
    const installer = new Installer(tempStoreDir);
    // Malicious git URL
    await expect(installer.installFromGit('https://evil.com/malicious/repo.git')).rejects.toThrowError(
      expect.objectContaining({ exitCode: 20 })
    );
    await expect(installer.installFromGit('git@evil.com:malicious/repo.git')).rejects.toThrowError(
      expect.objectContaining({ exitCode: 20 })
    );
    // Whitelisted git URL but fails clone
    await expect(installer.installFromGit('https://github.com/non-existent/repo.git')).rejects.toThrowError(
      expect.objectContaining({ exitCode: 20 })
    );
  });

  it('should enforce path traversal and permitted sandbox checks', async () => {
    const installer = new Installer(tempStoreDir);

    // Register root path
    const rootPath = path.parse(tempStoreDir).root;
    await expect(installer.registerLocal(rootPath)).rejects.toThrowError(
      expect.objectContaining({ exitCode: 21 })
    );

    // Register store directory
    await expect(installer.registerLocal(tempStoreDir)).rejects.toThrowError(
      expect.objectContaining({ exitCode: 21 })
    );

    // Uninstall path traversal ID
    await expect(installer.uninstall('../outside-sandbox')).rejects.toThrowError(
      expect.objectContaining({ exitCode: 22 })
    );
  });

  it('should reject ReDoS complexity patterns during installation', async () => {
    const installer = new Installer(tempStoreDir);

    // Create a local directory with complex/nested quantifiers in skill.json
    const complexLocalDir = path.join(os.tmpdir(), 'skillsmap-unit-complex-');
    const localDir = fs.mkdtempSync(complexLocalDir);
    try {
      const skillJson = {
        id: 'complex-skill',
        name: 'Complex Skill',
        description: 'Testing ReDoS validation',
        path: './index.js',
        tags: [],
        domain: 'test',
        triggers: {
          regex: ['(a+)+']
        }
      };
      fs.writeFileSync(path.join(localDir, 'skill.json'), JSON.stringify(skillJson), 'utf8');
      fs.writeFileSync(path.join(localDir, 'index.js'), '', 'utf8');

      await expect(installer.registerLocal(localDir)).rejects.toThrowError(
        expect.objectContaining({ exitCode: 21 })
      );
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });
});
