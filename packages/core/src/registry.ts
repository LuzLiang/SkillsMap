import * as fs from 'fs';
import * as path from 'path';
import { RegistryData, SkillNode, BM25Index, SkillsMapError } from './types';
import { getStoreDir, ensureStoreInitializedAsync, tokenize } from './utils';

/**
 * RegistryManager manages reading, writing, and synchronization of the skills registry metadata file (registry.json).
 */
export class RegistryManager {
  private storeDir: string;
  private registryPath: string;

  /**
   * Creates an instance of RegistryManager.
   * @param storeDir Database store directory path
   */
  constructor(storeDir?: string) {
    this.storeDir = storeDir || getStoreDir();
    this.registryPath = path.join(this.storeDir, 'registry.json');
  }

  /**
   * Asynchronously loads and parses the registry database file.
   * @returns Deserialized registry metadata
   */
  async load(): Promise<RegistryData> {
    await ensureStoreInitializedAsync(this.storeDir);
    try {
      const content = await fs.promises.readFile(this.registryPath, 'utf8');
      return JSON.parse(content) as RegistryData;
    } catch (err) {
      try {
        await fs.promises.access(this.registryPath);
      } catch {
        return { skills: {} };
      }
      throw new SkillsMapError(`Failed to parse registry.json (JSON is corrupted): ${(err as Error).message}`, 10);
    }
  }

  /**
   * Serializes and writes registry metadata back to disk.
   * @param data The registry data to persist
   */
  async save(data: RegistryData): Promise<void> {
    await ensureStoreInitializedAsync(this.storeDir);
    await fs.promises.writeFile(this.registryPath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Registers/updates a skill's metadata inside the active registry configuration.
   * @param id Unique identifier of the skill
   * @param source Source type ('git' or 'local')
   * @param pathOrUrl Path to folder or repository URL clone endpoint
   * @param version Semantic version label
   */
  async registerSkill(id: string, source: 'git' | 'local', pathOrUrl: string, version: string = '0.1.0'): Promise<void> {
    const data = await this.load();
    data.skills[id] = {
      source,
      url: source === 'git' ? pathOrUrl : undefined,
      localPath: source === 'local' ? pathOrUrl : undefined,
      installedAt: new Date().toISOString(),
      version
    };
    await this.save(data);
    await this.rebuildSkillsMap();
  }

  /**
   * Deregisters a skill from the metadata database file.
   * @param id Target skill identifier
   */
  async unregisterSkill(id: string): Promise<void> {
    const data = await this.load();
    if (data.skills[id]) {
      delete data.skills[id];
      await this.save(data);
      await this.rebuildSkillsMap();
    }
  }

  async getSkills() {
    return (await this.load()).skills;
  }

  /**
   * Recompiles all registered skill nodes and rebuilds the global skillsmap.json config and BM25 index file.
   * @param storePath Target store database directory path
   */
  async rebuildSkillsMap(storePath?: string): Promise<void> {
    const targetStoreDir = storePath || this.storeDir;
    const registryPath = path.join(targetStoreDir, 'registry.json');
    
    const exists = async (p: string) => {
      try {
        await fs.promises.access(p);
        return true;
      } catch {
        return false;
      }
    };

    if (!(await exists(registryPath))) {
      return;
    }
    
    let registry: RegistryData;
    try {
      const content = await fs.promises.readFile(registryPath, 'utf8');
      registry = JSON.parse(content);
    } catch (err) {
      throw new SkillsMapError(`Failed to parse registry.json in rebuildSkillsMap: ${(err as Error).message}`, 10);
    }

    const activeNodes: SkillNode[] = [];

    for (const id of Object.keys(registry.skills || {})) {
      try {
        const linkPath = path.join(targetStoreDir, 'skills', id);
        if (!(await exists(linkPath))) {
          continue;
        }
        const realDir = await fs.promises.realpath(linkPath);
        const skillJsonPath = path.join(realDir, 'skill.json');
        if (!(await exists(skillJsonPath))) {
          continue;
        }
        const skillJsonContent = await fs.promises.readFile(skillJsonPath, 'utf8');
        const skillJson = JSON.parse(skillJsonContent);
        const absolutePath = path.resolve(realDir, skillJson.path);
        const node: SkillNode = { ...skillJson, id, path: absolutePath };
        activeNodes.push(node);
      } catch {
        // Skip corrupted configurations
      }
    }

    await fs.promises.writeFile(
      path.join(targetStoreDir, 'skillsmap.json'),
      JSON.stringify(activeNodes, null, 2),
      'utf8'
    );

    // Compute the BM25 Index
    const indexData = buildBM25Index(activeNodes);

    await fs.promises.writeFile(
      path.join(targetStoreDir, 'skillsmap.index.json'),
      JSON.stringify(indexData, null, 2),
      'utf8'
    );
  }

  /**
   * Checks whether the computed BM25 index is up to date compared to registry and skill file modifications.
   * @param storePath Optional path to the registry database directory
   * @returns Resolves to true if the index is up to date, otherwise false
   */
  async isIndexUpToDate(storePath?: string): Promise<boolean> {
    const targetStoreDir = storePath || this.storeDir;
    const indexPath = path.join(targetStoreDir, 'skillsmap.index.json');
    const mapPath = path.join(targetStoreDir, 'skillsmap.json');
    const registryPath = path.join(targetStoreDir, 'registry.json');

    const exists = async (p: string) => {
      try {
        await fs.promises.access(p);
        return true;
      } catch {
        return false;
      }
    };

    if (!(await exists(indexPath)) || !(await exists(mapPath)) || !(await exists(registryPath))) {
      return false;
    }

    try {
      const indexStat = await fs.promises.stat(indexPath);
      const registryStat = await fs.promises.stat(registryPath);
      let maxInputTime = registryStat.mtimeMs;

      const registryContent = await fs.promises.readFile(registryPath, 'utf8');
      const registry = JSON.parse(registryContent) as RegistryData;

      for (const id of Object.keys(registry.skills || {})) {
        const skillJsonPath = path.join(targetStoreDir, 'skills', id, 'skill.json');
        if (await exists(skillJsonPath)) {
          const skillStat = await fs.promises.stat(skillJsonPath);
          if (skillStat.mtimeMs > maxInputTime) {
            maxInputTime = skillStat.mtimeMs;
          }
        }
      }

      return indexStat.mtimeMs >= maxInputTime;
    } catch {
      return false;
    }
  }
}

/**
 * Computes and constructs a normalized BM25 index object from a list of active skill nodes.
 * @param skills List of skill definitions to index
 * @returns Deserialized BM25 index structure for quick term matching
 */
export function buildBM25Index(skills: SkillNode[]): BM25Index {
  const docCount = skills.length;
  const docLengths: { [docId: string]: number } = {};
  const terms: { [term: string]: { [docId: string]: number } } = {};
  let totalLength = 0;

  for (const node of skills) {
    const descriptionText = node.description || '';
    const tokens = tokenize(descriptionText);
    docLengths[node.id] = tokens.length;
    totalLength += tokens.length;

    for (const token of tokens) {
      if (!terms[token]) {
        terms[token] = {};
      }
      terms[token][node.id] = (terms[token][node.id] || 0) + 1;
    }
  }

  const avgDocLength = docCount > 0 ? totalLength / docCount : 0;
  return {
    docCount,
    avgDocLength,
    docLengths,
    terms
  };
}

/**
 * Recompiles the skills map registry configuration and BM25 index file.
 * @param storePath Path to the database directory containing the registry
 */
export async function rebuildSkillsMap(storePath: string): Promise<void> {
  const manager = new RegistryManager(storePath);
  await manager.rebuildSkillsMap(storePath);
}

