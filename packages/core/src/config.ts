import * as fs from 'fs';
import * as path from 'path';
import { SkillNode, SkillsMapError } from './types';
import { getStoreDir, ensureStoreInitializedAsync } from './utils';
import { validateConfigSchema } from './validation';

const exists = async (p: string) => {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Loads the active skills configuration from the specified path, environment, or fallback.
 * Performs validation checks and returns the parsed configuration payload.
 * @param configPath Optional custom path to a configuration file
 * @returns Resolves to an object containing active skills list, default fallback node, and custom domains
 */
export async function loadConfig(configPath?: string): Promise<{ skills: SkillNode[]; fallbackNodeId?: string; domains?: Record<string, string[]> }> {
  let resolvedPath = configPath;
  await ensureStoreInitializedAsync();

  if (!resolvedPath) {
    if (process.env.SKILLSMAP_CONFIG_PATH) {
      resolvedPath = path.resolve(process.env.SKILLSMAP_CONFIG_PATH);
    } else if (await exists('./skillsmap.json')) {
      resolvedPath = path.resolve('./skillsmap.json');
    } else {
      resolvedPath = path.join(getStoreDir(), 'skillsmap.json');
    }
  } else {
    resolvedPath = path.resolve(resolvedPath);
  }

  if (!(await exists(resolvedPath))) {
    throw new SkillsMapError(`Config file not found at: ${resolvedPath}`, 11);
  }

  let rawContent: string;
  try {
    rawContent = await fs.promises.readFile(resolvedPath, 'utf8');
  } catch (err: any) {
    throw new SkillsMapError(`Failed to read config file: ${err.message}`, 10);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err: any) {
    throw new SkillsMapError(`Config parsing failed: ${err.message}`, 10);
  }

  validateConfigSchema(parsed);

  let skills = parsed.skills;
  if (skills === undefined && Array.isArray(parsed)) {
    skills = parsed;
  }
  skills = skills || [];

  let fallbackNodeId = parsed.fallbackNodeId;
  let domains = parsed.domains;

  if (parsed.extends === true) {
    const globalPath = path.join(getStoreDir(), 'skillsmap.json');
    if (globalPath !== resolvedPath && await exists(globalPath)) {
      try {
        const globalContent = await fs.promises.readFile(globalPath, 'utf8');
        const globalParsed = JSON.parse(globalContent);
        
        let globalSkills = globalParsed.skills;
        if (globalSkills === undefined && Array.isArray(globalParsed)) {
          globalSkills = globalParsed;
        }
        globalSkills = globalSkills || [];

        const localIds = new Set(skills.map((s: any) => s.id));
        const mergedSkills = [...skills];
        for (const gSkill of globalSkills) {
          if (!localIds.has(gSkill.id)) {
            mergedSkills.push(gSkill);
          }
        }
        skills = mergedSkills;
        if (!fallbackNodeId && globalParsed.fallbackNodeId) {
          fallbackNodeId = globalParsed.fallbackNodeId;
        }
        if (globalParsed.domains) {
          domains = { ...globalParsed.domains, ...domains };
        }
      } catch {
        // ignore global load errors
      }
    }
  }

  return { skills, fallbackNodeId, domains };
}
