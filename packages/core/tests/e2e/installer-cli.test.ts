import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCli } from '../helpers/cli-runner.js';

describe('SkillsMap CLI E2E Tests', () => {
  let mockLocalSkillDir: string;

  beforeEach(() => {
    // Create a mock local skill directory
    const tmpBaseLocal = path.join(os.tmpdir(), 'skillsmap-e2e-local-');
    mockLocalSkillDir = fs.mkdtempSync(tmpBaseLocal);
  });

  afterEach(() => {
    if (fs.existsSync(mockLocalSkillDir)) {
      fs.rmSync(mockLocalSkillDir, { recursive: true, force: true });
    }
  });

  it('should register a local skill and list it using CLI', async () => {
    const skillJson = {
      id: 'cli-local-skill',
      name: 'CLI Local Skill',
      description: 'Search description for cli local skill matching',
      path: './index.js',
      tags: ['cli', 'local'],
      domain: 'finance',
      category: 'e2e-test',
      version: '2.0.1'
    };
    fs.writeFileSync(
      path.join(mockLocalSkillDir, 'skill.json'),
      JSON.stringify(skillJson, null, 2),
      'utf8'
    );
    fs.writeFileSync(path.join(mockLocalSkillDir, 'index.js'), 'console.log("cli");', 'utf8');

    // Run cli register command
    const registerResult = await runCli(['register', mockLocalSkillDir]);
    expect(registerResult.exitCode).toBe(0);
    expect(registerResult.stdout).toContain('Successfully registered local skill');

    // Run cli list command with text format
    const listTextResult = await runCli(['list']);
    expect(listTextResult.exitCode).toBe(0);
    expect(listTextResult.stdout).toContain('cli-local-skill');
    expect(listTextResult.stdout).toContain('CLI Local Skill');

    // Run cli list command with json format
    const listJsonResult = await runCli(['list', '--format', 'json']);
    expect(listJsonResult.exitCode).toBe(0);
    const parsed = JSON.parse(listJsonResult.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('cli-local-skill');
    expect(parsed[0].version).toBe('2.0.1');

    // Run cli list filtered by non-existent domain
    const listFilteredEmpty = await runCli(['list', '--domain', 'nonexistent']);
    expect(listFilteredEmpty.exitCode).toBe(0);
    expect(listFilteredEmpty.stdout.trim()).toBe('No skills found.');

    // Run cli list filtered by domain (finance)
    const listFilteredDomain = await runCli(['list', '--domain', 'finance', '--format', 'json']);
    expect(listFilteredDomain.exitCode).toBe(0);
    const parsedDomain = JSON.parse(listFilteredDomain.stdout);
    expect(parsedDomain).toHaveLength(1);

    // Run cli rebuild command
    const rebuildResult = await runCli(['rebuild']);
    expect(rebuildResult.exitCode).toBe(0);
    expect(rebuildResult.stdout).toContain('Successfully rebuilt skillsmap');

    // Run cli uninstall command
    const uninstallResult = await runCli(['uninstall', 'cli-local-skill']);
    expect(uninstallResult.exitCode).toBe(0);
    expect(uninstallResult.stdout).toContain('Successfully uninstalled skill');

    // Verify it is no longer listed
    const listAfterResult = await runCli(['list', '--format', 'json']);
    expect(listAfterResult.exitCode).toBe(0);
    expect(JSON.parse(listAfterResult.stdout)).toHaveLength(0);
  });

  it('should return error exit code 21 when registering local skill without skill.json', async () => {
    const registerResult = await runCli(['register', mockLocalSkillDir]);
    expect(registerResult.exitCode).toBe(21);
  });
});
