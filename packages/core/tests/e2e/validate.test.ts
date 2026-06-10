import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runCli } from '../helpers/cli-runner.js';

describe('CLI - Validate Config', () => {
  it('T4.1 (Happy Path): Validates standard acyclic configuration DAG', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const configPath = path.join(storePath, 'happy-config.json');
    
    const validConfig = {
      skills: [
        {
          id: 'node-a',
          name: 'Node A',
          description: 'Node A',
          path: 'index.js',
          tags: [],
          domain: 'test',
          category: 'test'
        },
        {
          id: 'node-b',
          name: 'Node B',
          description: 'Node B',
          path: 'index.js',
          tags: [],
          domain: 'test',
          category: 'test',
          dependencies: ['node-a']
        }
      ]
    };
    fs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2));

    const result = await runCli(['validate', '-c', configPath]);
    expect(result.exitCode).toBe(0);
  });

  it('T4.2 (Config Discovery order): Tests discovery and extends merging', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const originalStorePath = process.env.SKILLSMAP_STORE_PATH;
    delete process.env.SKILLSMAP_STORE_PATH;
    
    try {
      // Create global skillsmap.json
      // Under HOME/.skillsmap/skillsmap.json
      const globalDir = path.join(storePath, '.skillsmap');
      fs.mkdirSync(globalDir, { recursive: true });
      const globalConfigPath = path.join(globalDir, 'skillsmap.json');
      const globalConfig = {
        skills: [
          {
            id: 'global-node',
            name: 'Global Node',
            description: 'Global Node',
            path: 'index.js',
            tags: [],
            domain: 'test',
            category: 'test'
          }
        ]
      };
      fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig, null, 2));

      // 1. CLI parameter --config <path>
      const customConfigPath = path.join(storePath, 'custom-config.json');
      const cycleConfig = {
        skills: [
          {
            id: 'cycle-node',
            name: 'Cycle',
            description: 'Cycle',
            path: 'index.js',
            tags: [],
            domain: 'test',
            category: 'test',
            dependencies: ['cycle-node']
          }
        ]
      };
      fs.writeFileSync(customConfigPath, JSON.stringify(cycleConfig, null, 2));
      
      let result = await runCli(['validate', '--config', customConfigPath], { reject: false });
      expect(result.exitCode).toBe(12); // Cycle detected

      // 2. Env SKILLSMAP_CONFIG_PATH
      const envConfigPath = path.join(storePath, 'env-config.json');
      fs.writeFileSync(envConfigPath, JSON.stringify(cycleConfig, null, 2));
      
      result = await runCli(['validate'], {
        env: { SKILLSMAP_CONFIG_PATH: envConfigPath },
        reject: false
      });
      expect(result.exitCode).toBe(12);

      // 3. CWD ./skillsmap.json (resolving extends)
      const testCwd = path.join(storePath, 'project-cwd');
      fs.mkdirSync(testCwd, { recursive: true });
      
      // Case A: extends: true (should merge global-node, validation succeeds)
      const extendsTrueConfig = {
        extends: true,
        skills: [
          {
            id: 'local-node',
            name: 'Local Node',
            description: 'Local Node',
            path: 'index.js',
            tags: [],
            domain: 'test',
            category: 'test',
            dependencies: ['global-node']
          }
        ]
      };
      fs.writeFileSync(path.join(testCwd, 'skillsmap.json'), JSON.stringify(extendsTrueConfig, null, 2));
      
      result = await runCli(['validate'], { cwd: testCwd });
      expect(result.exitCode).toBe(0);

      // Case B: extends: false (should not merge global-node, validation fails due to missing dependency)
      const extendsFalseConfig = {
        extends: false,
        skills: [
          {
            id: 'local-node',
            name: 'Local Node',
            description: 'Local Node',
            path: 'index.js',
            tags: [],
            domain: 'test',
            category: 'test',
            dependencies: ['global-node']
          }
        ]
      };
      fs.writeFileSync(path.join(testCwd, 'skillsmap.json'), JSON.stringify(extendsFalseConfig, null, 2));
      
      result = await runCli(['validate'], { cwd: testCwd, reject: false });
      // If dependencies are missing, it should either fail schema/dependency validation (exit code 11 or 12 depending on implementation)
      expect(result.exitCode).not.toBe(0);

      // 4. Global fallback ~/.skillsmap/skillsmap.json
      // Let's run from storePath (which does not have ./skillsmap.json)
      // Global config exists but is valid. Let's make global config invalid (cycle) to test it's used.
      fs.writeFileSync(globalConfigPath, JSON.stringify(cycleConfig, null, 2));
      result = await runCli(['validate'], { cwd: storePath, reject: false });
      expect(result.exitCode).toBe(12);
    } finally {
      process.env.SKILLSMAP_STORE_PATH = originalStorePath;
    }
  });

  it('T4.3 (Cycles - Exit 12): Detects cycles in dependencies', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    
    // Cycle A -> A
    const configA = {
      skills: [{
        id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c',
        dependencies: ['A']
      }]
    };
    const pathA = path.join(storePath, 'cycle-a.json');
    fs.writeFileSync(pathA, JSON.stringify(configA, null, 2));
    let result = await runCli(['validate', '-c', pathA], { reject: false });
    expect(result.exitCode).toBe(12);
    expect(result.stderr).toContain('Cycle detected');

    // Cycle A -> B -> A
    const configB = {
      skills: [
        { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['B'] },
        { id: 'B', name: 'B', description: 'B', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['A'] }
      ]
    };
    const pathB = path.join(storePath, 'cycle-b.json');
    fs.writeFileSync(pathB, JSON.stringify(configB, null, 2));
    result = await runCli(['validate', '-c', pathB], { reject: false });
    expect(result.exitCode).toBe(12);
    expect(result.stderr).toContain('Cycle detected');

    // Cycle A -> B -> C -> A
    const configC = {
      skills: [
        { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['B'] },
        { id: 'B', name: 'B', description: 'B', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['C'] },
        { id: 'C', name: 'C', description: 'C', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['A'] }
      ]
    };
    const pathC = path.join(storePath, 'cycle-c.json');
    fs.writeFileSync(pathC, JSON.stringify(configC, null, 2));
    result = await runCli(['validate', '-c', pathC], { reject: false });
    expect(result.exitCode).toBe(12);
    expect(result.stderr).toContain('Cycle detected');
  });

  it('T4.4 (Invalid Fallback - Exit 13): fallbackNodeId verification', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    
    // Non-existent fallbackNodeId
    const configNonExistent = {
      fallbackNodeId: 'non-existent-node',
      skills: [
        { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c' }
      ]
    };
    const pathNonExistent = path.join(storePath, 'fallback-non-existent.json');
    fs.writeFileSync(pathNonExistent, JSON.stringify(configNonExistent, null, 2));
    let result = await runCli(['validate', '-c', pathNonExistent], { reject: false });
    expect(result.exitCode).toBe(13);
    expect(result.stderr).toContain('fallbackNodeId');

    // Fallback refers to a node that is part of a cyclic dependency
    const configCyclicFallback = {
      fallbackNodeId: 'A',
      skills: [
        { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['A'] }
      ]
    };
    const pathCyclicFallback = path.join(storePath, 'fallback-cyclic.json');
    fs.writeFileSync(pathCyclicFallback, JSON.stringify(configCyclicFallback, null, 2));
    result = await runCli(['validate', '-c', pathCyclicFallback], { reject: false });
    // Should fail with 13 (or possibly 12, but specs say: "fallbackNodeId refers to ... one with cyclic dependencies -> exit 13")
    expect(result.exitCode).toBe(13);
    expect(result.stderr).toContain('fallbackNodeId');
  });
});
