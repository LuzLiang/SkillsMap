import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runCli } from '../helpers/cli-runner.js';

describe('CLI - Router Pipeline', () => {
  it('T5.1 (Stage 0 Domain Classification): Filters by domains and strips stopwords', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const configPath = path.join(storePath, 'domain-config.json');

    const config = {
      domains: {
        coding: ['code', 'refactor', 'function'],
        gamedev: ['unity', 'unreal', 'sprite']
      },
      skills: [
        {
          id: 'code-skill',
          name: 'Coding Skill',
          description: 'Writes code and performs code refactoring',
          path: 'index.js',
          tags: ['coding'],
          domain: 'coding',
          category: 'test',
          priority: 0
        },
        {
          id: 'game-skill',
          name: 'Game Skill',
          description: 'Unity unreal game developer',
          path: 'index.js',
          tags: ['unity'],
          domain: 'gamedev',
          category: 'test',
          priority: 0
        }
      ]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Prompt A: "Please write some code for me"
    // "please", "some", "for", "me" are stopwords.
    // Remaining: "write", "code".
    // "code" is in coding domain.
    // Overlap = 1. coding domain keywords length = 3.
    // coding score = 1 / (3 + 1) = 0.25 >= 0.15.
    // coding domain activates.
    // candidate is restricted to code-skill.
    let result = await runCli(['route', 'Please write some code for me', '-c', configPath]);
    expect(result.exitCode).toBe(0);
    let payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('success');
    expect(payload.match.id).toBe('code-skill');

    // Prompt B: "Hello there"
    // No domains activate. Bypasses domain classification. Both are evaluated.
    // We should be able to match game-skill if we mention 'unity'
    result = await runCli(['route', 'unity', '-c', configPath]);
    expect(result.exitCode).toBe(0);
    payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('success');
    expect(payload.match.id).toBe('game-skill');
  });

  it('T5.2 (Stage 1 Regex Matcher): Verifies regex matches, >500 char bypass, and invalid regexes', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const configPath = path.join(storePath, 'regex-config.json');

    const config = {
      skills: [
        {
          id: 'regex-skill',
          name: 'Regex Skill',
          description: 'Regex test',
          path: 'index.js',
          tags: [],
          domain: 'test',
          category: 'test',
          triggers: {
            regex: ['^deploy to prod$']
          }
        }
      ]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Happy match
    let result = await runCli(['route', 'deploy to prod', '-c', configPath]);
    expect(result.exitCode).toBe(0);
    let payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('success');
    expect(payload.match.id).toBe('regex-skill');
    expect(payload.metrics.regexScore).toBe(1.0);

    // > 500 characters bypasses regex matcher
    const longPrompt = 'a'.repeat(501) + ' deploy to prod';
    result = await runCli(['route', longPrompt, '-c', configPath]);
    payload = JSON.parse(result.stdout);
    // Regex score should be 0.0 now because it was bypassed
    expect(payload.metrics.regexScore).toBe(0.0);

    // Invalid regex (lookahead)
    const invalidConfig = {
      skills: [
        {
          id: 'invalid-regex-skill',
          name: 'Invalid',
          description: 'Invalid',
          path: 'index.js',
          tags: [],
          domain: 'test',
          category: 'test',
          triggers: {
            regex: ['(?<=deploy) prod'] // lookarounds are forbidden
          }
        }
      ]
    };
    const invalidConfigPath = path.join(storePath, 'invalid-regex-config.json');
    fs.writeFileSync(invalidConfigPath, JSON.stringify(invalidConfig, null, 2));
    result = await runCli(['route', 'deploy prod', '-c', invalidConfigPath], { reject: false });
    // Fails schema validation / regex compilation check with exit code 11
    expect(result.exitCode).toBe(11);
  });

  it('T5.3 (Stage 2 Keyword & Tag Matcher): Prunes nodes and calculates tag scores', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const configPath = path.join(storePath, 'keyword-config.json');

    const config = {
      skills: [
        {
          id: 'db-skill',
          name: 'Database Skill',
          description: 'Database operations',
          path: 'index.js',
          tags: ['sql', 'postgres'],
          domain: 'test',
          category: 'test',
          triggers: {
            keywords: ['database', 'sql'],
            keywordsMatch: 'all'
          }
        }
      ]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Keyword match not met (only database is matched, but keywordsMatch is 'all')
    let result = await runCli(['route', 'I want database', '-c', configPath]);
    let payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('no_match');

    // Keyword match met (both database and sql matched)
    result = await runCli(['route', 'database and sql query', '-c', configPath]);
    payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('success');
    expect(payload.match.id).toBe('db-skill');
    // Tag overlap with ['sql', 'postgres'] -> prompt has 'sql'. Overlap is 1. Tag length is 2.
    // Tag score = Math.sqrt(1 / 2) ≈ 0.7071
    expect(payload.metrics.tagScore).toBeCloseTo(0.7071, 4);
  });

  it('T5.4 (Stage 3 BM25 Matcher): Computes normalized BM25 score and tests automatic index recomputation', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const configPath = path.join(storePath, 'bm25-config.json');
    const indexPath = path.join(storePath, 'skillsmap.index.json');

    const config = {
      skills: [
        {
          id: 'bm25-skill',
          name: 'BM25 Skill',
          description: 'Specialized system for machine learning models',
          path: 'index.js',
          tags: [],
          domain: 'test',
          category: 'test'
        }
      ]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Pre-create index file
    await runCli(['index', '--rebuild', '-c', configPath]);
    expect(fs.existsSync(indexPath)).toBe(true);

    // Route query
    let result = await runCli(['route', 'machine learning', '-c', configPath]);
    let payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('success');
    expect(payload.metrics.bm25Score).toBeGreaterThan(0.0);
    expect(payload.metrics.bm25Score).toBeLessThanOrEqual(1.0);

    // Update config to trigger automatic in-memory recomputation (mod timestamp of config is newer than index file)
    // Wait a brief moment or change the mtime of configPath to be future
    const futureTime = new Date(Date.now() + 5000);
    fs.utimesSync(configPath, futureTime, futureTime);

    // Route should still succeed by recomputing index in-memory automatically
    result = await runCli(['route', 'machine learning', '-c', configPath]);
    payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('success');
    expect(payload.metrics.bm25Score).toBeGreaterThan(0.0);
  });

  it('T5.5 (Stage 4 Combined Score & Clamping): Calculates raw score, applies priority, and clamps to 0-1 range', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const configPath = path.join(storePath, 'clamp-config.json');

    const config = {
      skills: [
        {
          id: 'skill-low-priority',
          name: 'Low Priority Skill',
          description: 'Specialized match description',
          path: 'index.js',
          tags: ['test'],
          domain: 'test',
          category: 'test',
          priority: -0.5
        },
        {
          id: 'skill-high-priority',
          name: 'High Priority Skill',
          description: 'Specialized match description',
          path: 'index.js',
          tags: ['test'],
          domain: 'test',
          category: 'test',
          priority: 0.8
        }
      ]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Tie-breaker and combined score check
    let result = await runCli(['route', 'test Specialized match description', '-c', configPath]);
    let payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('success');
    // Since descriptions are identical and tags match, high priority node wins
    expect(payload.match.id).toBe('skill-high-priority');
    expect(payload.match.score).toBeLessThanOrEqual(1.0);
    expect(payload.match.score).toBeGreaterThanOrEqual(0.0);
  });

  it('T5.6 (Exit Codes): Exit 0 on match/fallback, Exit 1 if no match and no fallback', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    
    // No match and no fallback configuration
    const configNoFallback = {
      skills: [
        { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c' }
      ]
    };
    const pathNoFallback = path.join(storePath, 'route-no-fallback.json');
    fs.writeFileSync(pathNoFallback, JSON.stringify(configNoFallback, null, 2));
    
    let result = await runCli(['route', 'completely unmatched query', '-c', pathNoFallback], { reject: false });
    expect(result.exitCode).toBe(1);
    let payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('no_match');

    // No match but successful fallback
    const configWithFallback = {
      fallbackNodeId: 'A',
      skills: [
        { id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c' }
      ]
    };
    const pathWithFallback = path.join(storePath, 'route-with-fallback.json');
    fs.writeFileSync(pathWithFallback, JSON.stringify(configWithFallback, null, 2));

    result = await runCli(['route', 'completely unmatched query', '-c', pathWithFallback]);
    expect(result.exitCode).toBe(0);
    payload = JSON.parse(result.stdout);
    expect(payload.status).toBe('success');
    expect(payload.match.id).toBe('A');
  });
});
