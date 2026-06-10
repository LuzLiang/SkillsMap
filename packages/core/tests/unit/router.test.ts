import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Router } from '../../src/router';
import { SkillNode } from '../../src/types';
import {
  validateConfigSchema,
  checkCyclicDependencies,
  isRegexComplex,
  validateConfig
} from '../../src/validation';
import { loadConfig } from '../../src/config';
import { tokenize, getStoreDir, ensureStoreInitialized } from '../../src/utils';

describe('Router & Config Engine Unit Tests', () => {
  let tempStoreDir: string;
  let originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    const tmpBaseStore = path.join(os.tmpdir(), 'skillsmap-router-store-');
    tempStoreDir = fs.mkdtempSync(tmpBaseStore);

    originalEnv = {
      SKILLSMAP_STORE_PATH: process.env.SKILLSMAP_STORE_PATH,
    };
    process.env.SKILLSMAP_STORE_PATH = tempStoreDir;
  });

  afterEach(() => {
    if (fs.existsSync(tempStoreDir)) {
      fs.rmSync(tempStoreDir, { recursive: true, force: true });
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

  describe('Router Pipeline Tests', () => {
    const sampleSkills: SkillNode[] = [
      {
        id: 'coding-python',
        name: 'Python Coding',
        description: 'Write clean python script and run functions',
        path: 'index.js',
        tags: ['python', 'script', 'coding'],
        domain: 'coding',
        category: 'dev',
        priority: 0.1,
        triggers: {
          regex: ['^run python.*$'],
          keywords: ['python', 'script'],
          keywordsMatch: 'any'
        }
      },
      {
        id: 'coding-ts',
        name: 'TypeScript Coding',
        description: 'TypeScript function compile interface',
        path: 'index.js',
        tags: ['typescript', 'compile', 'interface'],
        domain: 'coding',
        category: 'dev',
        priority: 0.2,
        triggers: {
          keywords: ['typescript', 'compile'],
          keywordsMatch: 'all'
        }
      },
      {
        id: 'sysadmin-shell',
        name: 'Shell scripting',
        description: 'Run terminal bash commands, kill process',
        path: 'index.js',
        tags: ['bash', 'terminal', 'command'],
        domain: 'sysadmin',
        category: 'ops',
        priority: 0.0,
        triggers: {
          keywords: ['bash', 'terminal', 'kill'],
          keywordsMatch: 2 // at least 2 keywords
        }
      }
    ];

    it('should initialize with empty default settings', async () => {
      const router = new Router();
      const res = await router.route('hello');
      expect(res.status).toBe('no_match');
      expect(res.pathway).toEqual([]);
    });

    it('T5.1: Stage 0 Domain Classification', async () => {
      const router = new Router(sampleSkills);
      // "run bash command in terminal" has "bash", "terminal", "command"
      // "bash" is sysadmin domain keyword.
      // Sysadmin domain should activate and candidate is limited to sysadmin-shell.
      const res = await router.route('run bash terminal command');
      expect(res.status).toBe('success');
      expect(res.match?.id).toBe('sysadmin-shell');
    });

    it('T5.2: Stage 1 Regex Matcher', async () => {
      const router = new Router(sampleSkills);
      const res = await router.route('run python now');
      expect(res.status).toBe('success');
      expect(res.match?.id).toBe('coding-python');
      expect(res.metrics.regexScore).toBe(1.0);

      // Skip regex matcher if prompt is > 500 characters
      const longPrompt = 'run python ' + 'a'.repeat(550);
      const resLong = await router.route(longPrompt);
      expect(resLong.metrics.regexScore).toBe(0.0);
    });

    it('T5.3: Stage 2 Keyword & Tag Matcher', async () => {
      const router = new Router(sampleSkills);
      // keywordsMatch: 'all' for coding-ts, keywords: ['typescript', 'compile']
      // "typescript compilation" - does not have 'compile' (sub-string is checked)
      // "typescript compile error" - contains both.
      let res = await router.route('typescript compile error');
      expect(res.status).toBe('success');
      expect(res.match?.id).toBe('coding-ts');

      // Only 'java' - should not match any since keywords do not match
      res = await router.route('only java');
      expect(res.status).toBe('no_match');

      // sysadmin-shell keywordsMatch is 2. keywords: ['bash', 'terminal', 'kill']
      // "bash terminal" contains 2 keywords
      res = await router.route('bash terminal');
      expect(res.status).toBe('success');
      expect(res.match?.id).toBe('sysadmin-shell');

      // "bash only" contains 1 keyword - should fail keyword match
      res = await router.route('bash only');
      expect(res.status).toBe('no_match');
    });

    it('T5.4: BM25 Matcher & Index recomputation', async () => {
      ensureStoreInitialized(tempStoreDir);
      const configPath = path.join(tempStoreDir, 'skillsmap.json');
      fs.writeFileSync(configPath, JSON.stringify({ skills: sampleSkills }, null, 2));

      // Build index on disk
      const indexObj = {
        docCount: sampleSkills.length,
        avgDocLength: 4.5,
        docLengths: {
          'coding-python': 5,
          'coding-ts': 4,
          'sysadmin-shell': 5
        },
        terms: {
          python: { 'coding-python': 1 },
          typescript: { 'coding-ts': 1 },
          bash: { 'sysadmin-shell': 1 }
        }
      };
      const indexPath = path.join(tempStoreDir, 'skillsmap.index.json');
      fs.writeFileSync(indexPath, JSON.stringify(indexObj, null, 2));

      // Route using cached index
      const router = new Router(sampleSkills, undefined, undefined, configPath);
      let res = await router.route('python script', { noCache: false });
      expect(res.status).toBe('success');
      expect(res.metrics.bm25Score).toBeGreaterThan(0);

      // Recompute in-memory if index file is outdated (config modified)
      const futureTime = new Date(Date.now() + 10000);
      fs.utimesSync(configPath, futureTime, futureTime);

      res = await router.route('python script', { noCache: false });
      expect(res.status).toBe('success');
      expect(res.metrics.bm25Score).toBeGreaterThan(0);

      // Recompute in-memory if index docCount mismatch
      const indexCorruptObj = { ...indexObj, docCount: 999 };
      fs.writeFileSync(indexPath, JSON.stringify(indexCorruptObj, null, 2));
      res = await router.route('python script', { noCache: false });
      expect(res.status).toBe('success');
      expect(res.metrics.bm25Score).toBeGreaterThan(0);
    });

    it('T5.5: Combined Score, Priority Bias, and Tie-breaking', async () => {
      const skillsWithTie: SkillNode[] = [
        {
          id: 'skill-low-prio',
          name: 'Low Prio',
          description: 'matching description',
          path: 'index.js',
          tags: ['common'],
          domain: 'coding',
          category: 'test',
          priority: 0.1
        },
        {
          id: 'skill-high-prio',
          name: 'High Prio',
          description: 'matching description',
          path: 'index.js',
          tags: ['common'],
          domain: 'coding',
          category: 'test',
          priority: 0.5
        }
      ];

      const router = new Router(skillsWithTie);
      const res = await router.route('common matching description');
      expect(res.status).toBe('success');
      expect(res.match?.id).toBe('skill-high-prio');
    });

    it('T5.6: Fallback Logic & Dependency Pathway', async () => {
      const skillsWithFallback: SkillNode[] = [
        {
          id: 'fallback-node',
          name: 'Fallback Node',
          description: 'Fallback node description',
          path: 'index.js',
          tags: [],
          domain: 'coding',
          category: 'test',
          dependencies: ['dependency-node']
        },
        {
          id: 'dependency-node',
          name: 'Dependency Node',
          description: 'Dependency description',
          path: 'index.js',
          tags: [],
          domain: 'coding',
          category: 'test'
        }
      ];

      const router = new Router(skillsWithFallback, 'fallback-node');
      const res = await router.route('completely unmatched query');
      expect(res.status).toBe('success');
      expect(res.match?.id).toBe('fallback-node');
      expect(res.match?.score).toBe(0.0);
      expect(res.pathway).toEqual(['dependency-node', 'fallback-node']);
    });

    it('T5.7 (Milestone 2): BM25 NaN protection with empty descriptions', async () => {
      const skills: SkillNode[] = [
        { id: 'skill-a', name: 'A', description: '', path: 'index.js', tags: [], domain: 'coding', category: 'test' }
      ];
      const router = new Router(skills);
      const res = await router.route('some query');
      expect(res.status).toBe('no_match');
      expect(res.metrics.bm25Score).toBe(0);
    });

    it('T5.8 (Milestone 2): Empty and stopword-only prompt returns fallback or no-match immediately', async () => {
      const skills: SkillNode[] = [
        { id: 'skill-a', name: 'A', description: 'desc', path: 'index.js', tags: [], domain: 'coding', category: 'test' }
      ];
      const router = new Router(skills, 'skill-a');
      
      const resEmpty = await router.route('');
      expect(resEmpty.status).toBe('success');
      expect(resEmpty.match?.id).toBe('skill-a');
      expect(resEmpty.match?.score).toBe(0.0);

      const resStopwords = await router.route('please me some for');
      expect(resStopwords.status).toBe('success');
      expect(resStopwords.match?.id).toBe('skill-a');
      expect(resStopwords.match?.score).toBe(0.0);
    });

    it('T5.9 (Milestone 2): top matches option returns top N matches sorted by score descending', async () => {
      const skills: SkillNode[] = [
        { id: 'skill-a', name: 'A', description: 'match first', path: 'index.js', tags: ['match'], domain: 'coding', category: 'test', priority: 0.1 },
        { id: 'skill-b', name: 'B', description: 'match second', path: 'index.js', tags: ['match'], domain: 'coding', category: 'test', priority: 0.5 },
        { id: 'skill-c', name: 'C', description: 'no match', path: 'index.js', tags: [], domain: 'coding', category: 'test' }
      ];
      const router = new Router(skills);
      const res = await router.route('match', { top: 2 });
      expect(res.status).toBe('success');
      expect(res.matches).toBeDefined();
      expect(res.matches?.length).toBe(2);
      expect(res.matches?.[0].id).toBe('skill-b');
      expect(res.matches?.[1].id).toBe('skill-a');
    });

    it('T5.10 (Milestone 2): verbose option outputs steps to stderr', async () => {
      const skills: SkillNode[] = [
        { id: 'skill-a', name: 'A', description: 'desc', path: 'index.js', tags: [], domain: 'coding', category: 'test' }
      ];
      const router = new Router(skills);
      const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      
      await router.route('desc', { verbose: true });
      
      expect(stderrWriteSpy).toHaveBeenCalled();
      const calls = stderrWriteSpy.mock.calls.map(c => c[0].toString());
      expect(calls.some(c => c.includes('Routing prompt'))).toBe(true);
      expect(calls.some(c => c.includes('Tokenized prompt'))).toBe(true);
      expect(calls.some(c => c.includes('Evaluating skill'))).toBe(true);
      
      stderrWriteSpy.mockRestore();
    });
  });

  describe('Config Engine & Validation Tests', () => {
    it('validateConfigSchema validations', () => {
      // Non-object
      expect(() => validateConfigSchema(null)).toThrow('Config must be an object');
      expect(() => validateConfigSchema('string')).toThrow('Config must be an object');

      // Invalid skills field
      expect(() => validateConfigSchema({ skills: 'not-array' })).toThrow('/skills must be an array');

      // Invalid fallbackNodeId
      expect(() => validateConfigSchema({ skills: [], fallbackNodeId: 123 })).toThrow('/fallbackNodeId must be a string');

      // Invalid skill shape
      expect(() => validateConfigSchema({ skills: [null] })).toThrow('must be an object');
      expect(() => validateConfigSchema({ skills: [{}] })).toThrow('is required');

      // Invalid ID pattern
      const baseSkill = { name: 'A', description: 'A', path: 'index.js', tags: [] };
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'invalid id' }] })).toThrow('id must match pattern');

      // Invalid types
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', name: 123 }] })).toThrow('name must be a string');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', description: 123 }] })).toThrow('description must be a string');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', path: 123 }] })).toThrow('path must be a string');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', tags: [123] }] })).toThrow('tags must be an array of strings');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', dependencies: [123] }] })).toThrow('dependencies must be an array of strings');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', priority: 5.0 }] })).toThrow('priority must be a number between -1.0 and 1.0');

      // Triggers
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', triggers: 'invalid' }] })).toThrow('triggers must be an object');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', triggers: { regex: 'not-array' } }] })).toThrow('triggers/regex must be an array of strings');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', triggers: { keywords: 'not-array' } }] })).toThrow('triggers/keywords must be an array of strings');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', triggers: { keywordsMatch: 'invalid-string' } }] })).toThrow('keywordsMatch must be "all", "any" or an integer');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', triggers: { keywordsMatch: -5 } }] })).toThrow('keywordsMatch must be "all", "any" or an integer >= 1');
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', triggers: { keywordsMatch: {} } }] })).toThrow('keywordsMatch must be "all", "any" or an integer');

      // Valid cases (direct array and numeric keywordsMatch)
      expect(() => validateConfigSchema([{ ...baseSkill, id: 'ok' }])).not.toThrow();
      expect(() => validateConfigSchema({ skills: [{ ...baseSkill, id: 'ok', triggers: { keywordsMatch: 3 } }] })).not.toThrow();
    });

    it('checkCyclicDependencies validations', () => {
      const cyclicSkills: SkillNode[] = [
        { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['B'] },
        { id: 'B', name: 'B', description: 'B', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['A'] }
      ];
      expect(() => checkCyclicDependencies(cyclicSkills)).toThrow('Cycle detected');
    });

    it('isRegexComplex regex patterns', () => {
      expect(isRegexComplex('(?=lookahead)')).toBe(true);
      expect(isRegexComplex('(?<=lookbehind)')).toBe(true);
      expect(isRegexComplex('\\1')).toBe(true);
      expect(isRegexComplex('(a*)*')).toBe(true);
      expect(isRegexComplex('simple-pattern')).toBe(false);
    });

    it('loadConfig behavior', async () => {
      ensureStoreInitialized(tempStoreDir);
      const localConfigPath = path.join(tempStoreDir, 'local-skills.json');
      fs.writeFileSync(localConfigPath, JSON.stringify({ skills: [] }, null, 2));

      const { skills } = await loadConfig(localConfigPath);
      expect(skills).toEqual([]);

      // Test extends config merging
      const globalConfigPath = path.join(tempStoreDir, 'skillsmap.json');
      const globalSkill = { id: 'global-skill', name: 'G', description: 'G', path: 'index.js', tags: [], domain: 'd', category: 'c' };
      fs.writeFileSync(globalConfigPath, JSON.stringify({ skills: [globalSkill], fallbackNodeId: 'global-skill' }, null, 2));

      // Test extends config merging with domains
      fs.writeFileSync(globalConfigPath, JSON.stringify({
        skills: [globalSkill],
        fallbackNodeId: 'global-skill',
        domains: { globalDomain: ['keyword1'] }
      }, null, 2));

      fs.writeFileSync(localConfigPath, JSON.stringify({
        extends: true,
        skills: [],
        domains: { localDomain: ['keyword2'] }
      }, null, 2));
      
       const merged = await loadConfig(localConfigPath);
      expect(merged.skills).toHaveLength(1);
      expect(merged.skills[0].id).toBe('global-skill');
      expect(merged.fallbackNodeId).toBe('global-skill');
      expect(merged.domains).toBeDefined();
      expect(merged.domains?.globalDomain).toContain('keyword1');
      expect(merged.domains?.localDomain).toContain('keyword2');

      // Test config parsed as direct array
      fs.writeFileSync(localConfigPath, JSON.stringify([{ id: 'direct-array', name: 'D', description: 'D', path: 'index.js', tags: [] }]), 'utf8');
      const arrayConfig = await loadConfig(localConfigPath);
      expect(arrayConfig.skills).toHaveLength(1);
      expect(arrayConfig.skills[0].id).toBe('direct-array');

      // Test extends global config as direct array
      fs.writeFileSync(globalConfigPath, JSON.stringify([{ id: 'global-array-skill', name: 'G', description: 'G', path: 'index.js', tags: [] }]), 'utf8');
      fs.writeFileSync(localConfigPath, JSON.stringify({ extends: true, skills: [] }), 'utf8');
      const extendsArrayConfig = await loadConfig(localConfigPath);
      expect(extendsArrayConfig.skills).toHaveLength(1);
      expect(extendsArrayConfig.skills[0].id).toBe('global-array-skill');

      // Test extends config merging with corrupted global configuration (catch block)
      fs.writeFileSync(globalConfigPath, '{ corrupted json', 'utf8');
      fs.writeFileSync(localConfigPath, JSON.stringify({ extends: true, skills: [] }), 'utf8');
      const mergedCorrupted = await loadConfig(localConfigPath);
      expect(mergedCorrupted.skills).toHaveLength(0); // Should fall back and return empty skills list without throwing

      // loadConfig error cases
      await expect(loadConfig('non-existent-config.json')).rejects.toThrow('Config file not found');
      
      const corruptedConfigPath = path.join(tempStoreDir, 'corrupted-config.json');
      fs.writeFileSync(corruptedConfigPath, '{ corrupted json', 'utf8');
      await expect(loadConfig(corruptedConfigPath)).rejects.toThrow('Config parsing failed');

      // read directory error
      await expect(loadConfig(tempStoreDir)).rejects.toThrow('Failed to read config file');

      // loadConfig with environment variable
      const backupEnvPath = process.env.SKILLSMAP_CONFIG_PATH;
      try {
        process.env.SKILLSMAP_CONFIG_PATH = localConfigPath;
        // Rewrite localConfigPath to a valid configuration object
        fs.writeFileSync(localConfigPath, JSON.stringify({ skills: [] }), 'utf8');
        const configFromEnv = await loadConfig();
        expect(configFromEnv.skills).toBeDefined();
      } finally {
        if (backupEnvPath) {
          process.env.SKILLSMAP_CONFIG_PATH = backupEnvPath;
        } else {
          delete process.env.SKILLSMAP_CONFIG_PATH;
        }
      }

      // loadConfig default current directory path
      const localCurrentDirConfig = path.resolve('./skillsmap.json');
      fs.writeFileSync(localCurrentDirConfig, JSON.stringify({ skills: [] }), 'utf8');
      try {
        const configFromCurrent = await loadConfig();
        expect(configFromCurrent.skills).toHaveLength(0);
      } finally {
        if (fs.existsSync(localCurrentDirConfig)) {
          fs.unlinkSync(localCurrentDirConfig);
        }
      }

      // loadConfig default global path (should resolve successfully since ensureStoreInitializedAsync initializes it)
      const backupStorePath = process.env.SKILLSMAP_STORE_PATH;
      try {
        process.env.SKILLSMAP_STORE_PATH = path.join(tempStoreDir, 'non-existent-store-path');
        const defaultGlobalConfig = await loadConfig();
        expect(defaultGlobalConfig.skills).toHaveLength(0);
      } finally {
        process.env.SKILLSMAP_STORE_PATH = backupStorePath;
      }
    });

    it('validateConfig behavior', async () => {
      ensureStoreInitialized(tempStoreDir);
      const configPath = path.join(tempStoreDir, 'val-config.json');

      // Valid entrypoint file exists
      const entrypointExistsConfig = {
        skills: [
          { id: 'A', name: 'A', description: 'A', path: configPath, tags: [], domain: 't', category: 'c' }
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(entrypointExistsConfig), 'utf8');
      await expect(validateConfig(configPath)).resolves.not.toThrow();

      // Missing dependency
      const invalidDep = {
        skills: [
          { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['NONEXIST'] }
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(invalidDep), 'utf8');
      await expect(validateConfig(configPath)).rejects.toThrow('dependency "NONEXIST" of skill "A" does not exist');

      // Fallback node doesn't exist
      const invalidFallback = {
        fallbackNodeId: 'B',
        skills: [
          { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c' }
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(invalidFallback), 'utf8');
      await expect(validateConfig(configPath)).rejects.toThrow('fallbackNodeId "B" does not exist');

      // Fallback node is part of a cycle
      const cyclicFallback = {
        fallbackNodeId: 'A',
        skills: [
          { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['B'] },
          { id: 'B', name: 'B', description: 'B', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['A'] }
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(cyclicFallback), 'utf8');
      await expect(validateConfig(configPath)).rejects.toThrow('is part of a cyclic dependency');

      // Diamond shape dependency (no cycle, but shared dependency visited twice)
      const diamondConfig = {
        fallbackNodeId: 'A',
        skills: [
          { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['B', 'C'] },
          { id: 'B', name: 'B', description: 'B', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['D'] },
          { id: 'C', name: 'C', description: 'C', path: 'index.js', tags: [], domain: 't', category: 'c', dependencies: ['D'] },
          { id: 'D', name: 'D', description: 'D', path: 'index.js', tags: [], domain: 't', category: 'c' }
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(diamondConfig), 'utf8');
      await expect(validateConfig(configPath)).resolves.not.toThrow();

      // Complex regex in validateConfig
      const complexRegexConfig = {
        skills: [
          {
            id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c',
            triggers: { regex: ['(?=lookahead)'] }
          }
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(complexRegexConfig), 'utf8');
      await expect(validateConfig(configPath)).rejects.toThrow('is too complex');

      // Invalid regex in validateConfig
      const invalidRegexConfig = {
        skills: [
          {
            id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c',
            triggers: { regex: ['[invalid-regex'] }
          }
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(invalidRegexConfig), 'utf8');
      await expect(validateConfig(configPath)).rejects.toThrow('is invalid');

      // Missing entrypoint warning
      const missingEntrypointConfig = {
        skills: [
          { id: 'A', name: 'A', description: 'A', path: 'non-existent-file.js', tags: [], domain: 't', category: 'c' }
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(missingEntrypointConfig), 'utf8');
      
      const originalError = console.error;
      let errorMsg = '';
      console.error = (msg: string) => { errorMsg = msg; };
      try {
        await validateConfig(configPath);
        expect(errorMsg).toContain('Entrypoint file inside registered path does not exist');
      } finally {
        console.error = originalError;
      }
    });
  });

  describe('Utils Module Tests', () => {
    it('should tokenize correctly', () => {
      const tokens = tokenize('The quick brown fox jumps over the lazy dog');
      expect(tokens).toContain('quick');
      expect(tokens).toContain('brown');
      expect(tokens).not.toContain('the'); // Stopword
    });

    it('should fall back correctly if environment variables are not set in getStoreDir', () => {
      const backupStorePath = process.env.SKILLSMAP_STORE_PATH;
      delete process.env.SKILLSMAP_STORE_PATH;

      const dir = getStoreDir();
      expect(dir).toBeDefined();

      if (backupStorePath) {
        process.env.SKILLSMAP_STORE_PATH = backupStorePath;
      }
    });

    it('should initialize store and create directory if it does not exist', () => {
      const nonExistentDir = path.join(tempStoreDir, 'nested-new-store');
      expect(fs.existsSync(nonExistentDir)).toBe(false);
      ensureStoreInitialized(nonExistentDir);
      expect(fs.existsSync(nonExistentDir)).toBe(true);
    });

    it('should fallback candidateSkills to all skills if activeDomains filter leaves 0 candidates', async () => {
      const skills = [{
        id: 'coding-python',
        name: 'Python Coding',
        description: 'test',
        path: 'index.js',
        tags: [],
        domain: 'coding',
        category: 'dev'
      }];
      const router = new Router(skills);
      const res = await router.route('run terminal bash commands');
      expect(res.status).toBe('no_match');
    });

    it('should handle invalid regex and ignore it in Router direct instantiation', async () => {
      const skills = [{
        id: 'bad-regex',
        name: 'Bad Regex',
        description: 'completely unmatched description',
        path: 'index.js',
        tags: [],
        domain: 'test',
        category: 'unit-test',
        triggers: { regex: ['[invalid-regex'] }
      }];
      const router = new Router(skills);
      const res = await router.route('test');
      expect(res.status).toBe('no_match');
    });

    it('should sort by priority when combined scores are clamped to 1.0', async () => {
      const skills = [
        {
          id: 'prio-low',
          name: 'Low Prio',
          description: 'matching description',
          path: 'index.js',
          tags: [],
          domain: 'test',
          category: 'unit-test',
          priority: 0.1,
          triggers: { regex: ['^test$'] }
        },
        {
          id: 'prio-high',
          name: 'High Prio',
          description: 'matching description',
          path: 'index.js',
          tags: [],
          domain: 'test',
          category: 'unit-test',
          priority: 0.5,
          triggers: { regex: ['^test$'] }
        }
      ];
      const router = new Router(skills);
      const res = await router.route('test');
      expect(res.status).toBe('success');
      expect(res.match?.id).toBe('prio-high');
    });
  });
});
