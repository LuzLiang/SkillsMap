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
  };
}

describe('CLI - Register Local Skill', () => {
  it('T2.1 (Happy Path): Registers local directory containing valid skill.json', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const localSkillDir = path.join(storePath, 'local-skills', 'valid-local-skill');
    fs.mkdirSync(localSkillDir, { recursive: true });
    
    const skillJson = {
      id: 'valid-local-skill',
      name: 'Valid Local Skill',
      description: 'A valid local skill.',
      path: 'index.js',
      tags: ['local', 'test'],
      domain: 'testing',
      category: 'utility'
    };
    
    fs.writeFileSync(path.join(localSkillDir, 'skill.json'), JSON.stringify(skillJson, null, 2));
    fs.writeFileSync(path.join(localSkillDir, 'index.js'), 'console.log("local node");');

    const result = await runCli(['register', localSkillDir]);
    expect(result.exitCode).toBe(0);

    const paths = getStorePaths();
    
    // Check registry.json
    expect(fs.existsSync(paths.registry)).toBe(true);
    const registry = JSON.parse(fs.readFileSync(paths.registry, 'utf-8'));
    expect(registry.skills['valid-local-skill']).toBeDefined();
    expect(registry.skills['valid-local-skill'].source).toBe('local');
    expect(registry.skills['valid-local-skill'].localPath).toBe(localSkillDir);

    // Check skillsmap.json
    expect(fs.existsSync(paths.skillsmap)).toBe(true);
    const skillsmap = JSON.parse(fs.readFileSync(paths.skillsmap, 'utf-8'));
    const skillsList = Array.isArray(skillsmap) ? skillsmap : Object.values(skillsmap.skills || skillsmap);
    const registeredSkill = skillsList.find((s: any) => s.id === 'valid-local-skill');
    expect(registeredSkill).toBeDefined();
    expect(registeredSkill.path).toBe(fs.realpathSync(path.join(localSkillDir, 'index.js')));
  });

  it('T2.2 (Dir Not Found - Exit 21): Attempt to register a non-existent local directory', async () => {
    const nonExistentDir = path.join(process.env.SKILLSMAP_STORE_PATH!, 'does-not-exist');
    const result = await runCli(['register', nonExistentDir], { reject: false });
    expect(result.exitCode).toBe(21);
    expect(result.stderr).toContain('not found');
  });

  it('T2.3 (Missing skill.json - Exit 21): Directory exists but lacks skill.json', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const localSkillDir = path.join(storePath, 'local-skills', 'no-skill-json');
    fs.mkdirSync(localSkillDir, { recursive: true });
    fs.writeFileSync(path.join(localSkillDir, 'index.js'), 'console.log("no skill.json");');

    const result = await runCli(['register', localSkillDir], { reject: false });
    expect(result.exitCode).toBe(21);
    expect(result.stderr).toContain('skill.json');
  });
});
