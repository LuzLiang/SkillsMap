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
    index: path.join(root, 'skillsmap.index.json'),
  };
}

describe('CLI - Index Command', () => {
  it('T7.1 (Happy Path): index --rebuild generates BM25 and writes skillsmap.index.json', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const configPath = path.join(storePath, 'valid-config.json');

    const config = {
      skills: [
        {
          id: 'node-a',
          name: 'Node A',
          description: 'This is the description for node A containing keywords like typescript and node.',
          path: 'index.js',
          tags: ['js'],
          domain: 'coding',
          category: 'test'
        },
        {
          id: 'node-b',
          name: 'Node B',
          description: 'This is the description for node B containing keywords like python and django.',
          path: 'index.js',
          tags: ['python'],
          domain: 'coding',
          category: 'test'
        }
      ]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await runCli(['index', '--rebuild', '-c', configPath]);
    expect(result.exitCode).toBe(0);

    const paths = getStorePaths();
    expect(fs.existsSync(paths.index)).toBe(true);

    const indexContent = JSON.parse(fs.readFileSync(paths.index, 'utf-8'));
    // The index content should contain IDF values or term frequencies
    expect(indexContent).toBeDefined();
    // Usually BM25 index has a structure containing corpus terms or document stats
    expect(indexContent.terms || indexContent.idf || indexContent.docs).toBeDefined();
  });

  it('T7.2 (Outdated BM25 Checks): Rebuilding handles empty arrays or punctuation-heavy text, and fails indexing if config is invalid', async () => {
    const storePath = process.env.SKILLSMAP_STORE_PATH!;
    const configPath = path.join(storePath, 'punctuation-config.json');

    const config = {
      skills: [
        {
          id: 'node-punct',
          name: 'Punctuation Node',
          description: '!!! ,,, ???  ... ---', // Only punctuation
          path: 'index.js',
          tags: [],
          domain: 'coding',
          category: 'test'
        }
      ]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Should successfully compile without throwing index errors
    let result = await runCli(['index', '--rebuild', '-c', configPath]);
    expect(result.exitCode).toBe(0);

    // Fail indexing with cycle (Exit 12)
    const cyclicConfig = {
      skills: [
        {
          id: 'A', name: 'A', description: 'A', path: 'index.js', tags: [], domain: 't', category: 'c',
          dependencies: ['A']
        }
      ]
    };
    const cyclicPath = path.join(storePath, 'cyclic-config.json');
    fs.writeFileSync(cyclicPath, JSON.stringify(cyclicConfig, null, 2));
    result = await runCli(['index', '--rebuild', '-c', cyclicPath], { reject: false });
    expect(result.exitCode).toBe(12);

    // Fail indexing with schema violation (Exit 11)
    const invalidConfig = {
      skills: [
        {
          id: 'invalid-id-!', // invalid characters
          name: 'Invalid',
          path: 'index.js'
          // missing description, domain
        }
      ]
    };
    const invalidPath = path.join(storePath, 'invalid-config.json');
    fs.writeFileSync(invalidPath, JSON.stringify(invalidConfig, null, 2));
    result = await runCli(['index', '--rebuild', '-c', invalidPath], { reject: false });
    expect(result.exitCode).toBe(11);
  });
});
