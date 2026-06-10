import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runCli } from '../helpers/cli-runner.js';

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

describe('CLI - Uninstall Skill', () => {
  it('T3.1 (Happy Path): Uninstall an existing skill, removes directory (if git-source), deletes registry entry, rebuilds', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    
    const localSkillDir = path.join(storePath, 'local-skills', 'skill-a');
    fs.mkdirSync(localSkillDir, { recursive: true });
    fs.writeFileSync(path.join(localSkillDir, 'skill.json'), JSON.stringify({
      id: 'skill-a',
      name: 'Skill A',
      description: 'Skill A description',
      path: 'index.js',
      tags: [],
      domain: 'testing',
      category: 'utility'
    }, null, 2));
    fs.writeFileSync(path.join(localSkillDir, 'index.js'), 'console.log("A");');
    
    let res = await runCli(['register', localSkillDir]);
    expect(res.exitCode).toBe(0);

    const paths = getStorePaths();
    let registry = JSON.parse(fs.readFileSync(paths.registry, 'utf-8'));
    expect(registry.skills['skill-a']).toBeDefined();

    res = await runCli(['uninstall', 'skill-a']);
    expect(res.exitCode).toBe(0);

    registry = JSON.parse(fs.readFileSync(paths.registry, 'utf-8'));
    expect(registry.skills['skill-a']).toBeUndefined();

    const skillsmap = JSON.parse(fs.readFileSync(paths.skillsmap, 'utf-8'));
    const skillsList = Array.isArray(skillsmap) ? skillsmap : Object.values(skillsmap.skills || skillsmap);
    expect(skillsList.some((s: any) => s.id === 'skill-a')).toBe(false);
  });

  it('T3.2 (Dependency Conflict - Exit 22): Uninstalling skill with dependent skills aborts', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    
    const dirA = path.join(storePath, 'local-skills', 'skill-dep-a');
    fs.mkdirSync(dirA, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'skill.json'), JSON.stringify({
      id: 'skill-dep-a',
      name: 'Skill A',
      description: 'Skill A',
      path: 'index.js',
      tags: [],
      domain: 'testing',
      category: 'utility'
    }, null, 2));
    fs.writeFileSync(path.join(dirA, 'index.js'), '');
    await runCli(['register', dirA]);

    const dirB = path.join(storePath, 'local-skills', 'skill-dep-b');
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'skill.json'), JSON.stringify({
      id: 'skill-dep-b',
      name: 'Skill B',
      description: 'Skill B',
      path: 'index.js',
      tags: [],
      domain: 'testing',
      category: 'utility',
      dependencies: ['skill-dep-a']
    }, null, 2));
    fs.writeFileSync(path.join(dirB, 'index.js'), '');
    await runCli(['register', dirB]);

    const result = await runCli(['uninstall', 'skill-dep-a'], { reject: false });
    expect(result.exitCode).toBe(22);
    expect(result.stderr).toContain('Cannot uninstall');
    expect(result.stderr).toContain('skill-dep-b');
  });

  it('T3.3 (Forced Uninstall - Exit 0): Force uninstall overrides dependency conflict', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    
    const dirA = path.join(storePath, 'local-skills', 'skill-dep-a');
    fs.mkdirSync(dirA, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'skill.json'), JSON.stringify({
      id: 'skill-dep-a',
      name: 'Skill A',
      description: 'Skill A',
      path: 'index.js',
      tags: [],
      domain: 'testing',
      category: 'utility'
    }, null, 2));
    fs.writeFileSync(path.join(dirA, 'index.js'), '');
    await runCli(['register', dirA]);

    const dirB = path.join(storePath, 'local-skills', 'skill-dep-b');
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'skill.json'), JSON.stringify({
      id: 'skill-dep-b',
      name: 'Skill B',
      description: 'Skill B',
      path: 'index.js',
      tags: [],
      domain: 'testing',
      category: 'utility',
      dependencies: ['skill-dep-a']
    }, null, 2));
    fs.writeFileSync(path.join(dirB, 'index.js'), '');
    await runCli(['register', dirB]);

    const result = await runCli(['uninstall', 'skill-dep-a', '--force']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Warning');
    
    const paths = getStorePaths();
    const registry = JSON.parse(fs.readFileSync(paths.registry, 'utf-8'));
    expect(registry.skills['skill-dep-a']).toBeUndefined();
  });
});
