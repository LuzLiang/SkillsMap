import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runCli } from '../helpers/cli-runner.js';

describe('CLI - List Command', () => {
  it('T6.1 (Format CLI options): default text tabular format vs json format', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    
    // Register two local skills
    const dirA = path.join(storePath, 'local-skills', 'skill-a');
    fs.mkdirSync(dirA, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'skill.json'), JSON.stringify({
      id: 'skill-a',
      name: 'Skill A',
      description: 'Skill A',
      path: 'index.js',
      tags: [],
      domain: 'coding',
      category: 'test'
    }, null, 2));
    fs.writeFileSync(path.join(dirA, 'index.js'), '');
    await runCli(['register', dirA]);

    const dirB = path.join(storePath, 'local-skills', 'skill-b');
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'skill.json'), JSON.stringify({
      id: 'skill-b',
      name: 'Skill B',
      description: 'Skill B',
      path: 'index.js',
      tags: [],
      domain: 'design',
      category: 'test'
    }, null, 2));
    fs.writeFileSync(path.join(dirB, 'index.js'), '');
    await runCli(['register', dirB]);

    // Test default format (text / table)
    let result = await runCli(['list']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('skill-a');
    expect(result.stdout).toContain('skill-b');
    // It should look tabular (e.g. headers or column names)
    expect(result.stdout).toContain('ID');
    expect(result.stdout).toContain('Name');

    // Test JSON format
    result = await runCli(['list', '--format', 'json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    
    const ids = parsed.map((item: any) => item.id);
    expect(ids).toContain('skill-a');
    expect(ids).toContain('skill-b');
  });

  it('T6.2 (Domain filtering): --domain filters list', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    
    // Register two local skills
    const dirA = path.join(storePath, 'local-skills', 'skill-a');
    fs.mkdirSync(dirA, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'skill.json'), JSON.stringify({
      id: 'skill-a',
      name: 'Skill A',
      description: 'Skill A',
      path: 'index.js',
      tags: [],
      domain: 'coding',
      category: 'test'
    }, null, 2));
    fs.writeFileSync(path.join(dirA, 'index.js'), '');
    await runCli(['register', dirA]);

    const dirB = path.join(storePath, 'local-skills', 'skill-b');
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'skill.json'), JSON.stringify({
      id: 'skill-b',
      name: 'Skill B',
      description: 'Skill B',
      path: 'index.js',
      tags: [],
      domain: 'design',
      category: 'test'
    }, null, 2));
    fs.writeFileSync(path.join(dirB, 'index.js'), '');
    await runCli(['register', dirB]);

    // Filter by coding domain
    let result = await runCli(['list', '--domain', 'coding', '--format', 'json']);
    expect(result.exitCode).toBe(0);
    let parsed = JSON.parse(result.stdout);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe('skill-a');

    // Filter by design domain
    result = await runCli(['list', '--domain', 'design', '--format', 'json']);
    expect(result.exitCode).toBe(0);
    parsed = JSON.parse(result.stdout);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe('skill-b');

    // Filter by non-existent domain should return empty
    result = await runCli(['list', '--domain', 'nonexistent', '--format', 'json']);
    expect(result.exitCode).toBe(0);
    parsed = JSON.parse(result.stdout);
    expect(parsed.length).toBe(0);
  });
});
