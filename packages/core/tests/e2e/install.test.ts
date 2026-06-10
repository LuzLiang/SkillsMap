import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { execa } from 'execa';
import { runCli } from '../helpers/cli-runner.js';

async function createMockGitRepo(name: string, skillJsonContent: string | Record<string, any>, files: Record<string, string> = {}) {
  const storePath = process.env.SKILLSMAP_STORE_PATH!;
  const repoDir = path.join(storePath, 'mock-repos', name);
  fs.mkdirSync(repoDir, { recursive: true });
  
  const skillJsonStr = typeof skillJsonContent === 'string'
    ? skillJsonContent
    : JSON.stringify(skillJsonContent, null, 2);
    
  fs.writeFileSync(path.join(repoDir, 'skill.json'), skillJsonStr);
  
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  
  await execa('git', ['init'], { cwd: repoDir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
  await execa('git', ['config', 'init.defaultBranch', 'main'], { cwd: repoDir });
  await execa('git', ['add', '.'], { cwd: repoDir });
  await execa('git', ['commit', '-m', 'initial commit'], { cwd: repoDir });
  
  return pathToFileURL(repoDir).href;
}

function getStorePaths() {
  const storePath = process.env.SKILLSMAP_STORE_PATH!;
  const isDirectStore = fs.existsSync(path.join(storePath, 'registry.json')) || 
                        fs.existsSync(path.join(storePath, 'skillsmap.json'));
  
  const root = isDirectStore ? storePath : path.join(storePath, '.skillsmap');
  return {
    registry: path.join(root, 'registry.json'),
    skillsmap: path.join(root, 'skillsmap.json'),
    skillsDir: path.join(root, 'skills'),
  };
}

describe('CLI - Install Git Skill', () => {
  it('T1.1 (Happy Path): Installs valid local git repository', async () => {
    const skillJson = {
      id: 'valid-git-skill',
      name: 'Valid Git Skill',
      description: 'A valid skill from a git repository.',
      path: 'dist/index.js',
      tags: ['git', 'test'],
      domain: 'testing',
      category: 'utility'
    };
    const gitUrl = await createMockGitRepo('valid-git-repo', skillJson, {
      'dist/index.js': 'console.log("hello world");'
    });

    const result = await runCli(['install', gitUrl]);
    expect(result.exitCode).toBe(0);

    const paths = getStorePaths();
    
    // Check registry.json
    expect(fs.existsSync(paths.registry)).toBe(true);
    const registry = JSON.parse(fs.readFileSync(paths.registry, 'utf-8'));
    expect(registry.skills['valid-git-skill']).toBeDefined();
    expect(registry.skills['valid-git-skill'].source).toBe('git');
    expect(registry.skills['valid-git-skill'].url).toBe(gitUrl);

    // Check skillsmap.json
    expect(fs.existsSync(paths.skillsmap)).toBe(true);
    const skillsmap = JSON.parse(fs.readFileSync(paths.skillsmap, 'utf-8'));
    const skillsList = Array.isArray(skillsmap) ? skillsmap : Object.values(skillsmap.skills || skillsmap);
    const installedSkill = skillsList.find((s: any) => s.id === 'valid-git-skill');
    expect(installedSkill).toBeDefined();
    expect(path.isAbsolute(installedSkill.path)).toBe(true);
    expect(fs.existsSync(installedSkill.path)).toBe(true);
    expect(fs.readFileSync(installedSkill.path, 'utf-8')).toContain('hello world');
  });

  it('T1.2 (Git Fail - Exit 20): Try installing from a non-existent local git path', async () => {
    const nonExistentGitUrl = 'file:///non/existent/git/repo';
    const result = await runCli(['install', nonExistentGitUrl], { reject: false });
    expect(result.exitCode).toBe(20);
    expect(result.stderr).toContain('failed'); // or some error context
  });

  it('T1.3 (Missing skill.json - Exit 21): Try installing from a repository lacking skill.json', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const repoDir = path.join(storePath, 'mock-repos', 'no-skill-json-repo');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'dummy.txt'), 'hello');

    await execa('git', ['init'], { cwd: repoDir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    await execa('git', ['config', 'init.defaultBranch', 'main'], { cwd: repoDir });
    await execa('git', ['add', '.'], { cwd: repoDir });
    await execa('git', ['commit', '-m', 'initial commit'], { cwd: repoDir });

    const gitUrl = pathToFileURL(repoDir).href;
    const result = await runCli(['install', gitUrl], { reject: false });
    expect(result.exitCode).toBe(21);
    expect(result.stderr).toContain('skill.json');
  });

  it('T1.4 (Malformed JSON - Exit 10): Malformed JSON syntax in skill.json', async () => {
    const badJsonStr = `{ "id": "bad-json", "name": "Bad JSON", "description": `;
    const gitUrl = await createMockGitRepo('malformed-json-repo', badJsonStr);
    
    const result = await runCli(['install', gitUrl], { reject: false });
    expect(result.exitCode).toBe(10);
    expect(result.stderr).toContain('parsing failed');
  });

  it('T1.5 (Schema Violation - Exit 11): Schema violations in skill.json', async () => {
    const invalidSkillJson = {
      id: 'invalid id with spaces!',
      name: 'Invalid Skill ID',
      path: 'index.js',
      tags: []
    };
    const gitUrl = await createMockGitRepo('schema-violation-repo', invalidSkillJson);

    const result = await runCli(['install', gitUrl], { reject: false });
    expect(result.exitCode).toBe(11);
    expect(result.stderr).toContain('validation failed');
  });

  it('T1.6 (Missing entry point path - Exit 0): Warns but exits with 0 if entry path file doesn\'t exist', async () => {
    const skillJson = {
      id: 'missing-entry-skill',
      name: 'Missing Entry Skill',
      description: 'A skill with a missing entry point.',
      path: 'dist/missing.js',
      tags: ['missing'],
      domain: 'testing',
      category: 'utility'
    };
    const gitUrl = await createMockGitRepo('missing-entry-repo', skillJson);

    const result = await runCli(['install', gitUrl]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Warning');
  });
});
