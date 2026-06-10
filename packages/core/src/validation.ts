import * as fs from 'fs';
import { SkillNode, SkillsMapError } from './types';
import { loadConfig } from './config';

/**
 * Analyzes a regular expression pattern to detect high complexity or potential ReDoS vulnerabilities.
 * Checks for features like lookarounds, backreferences, nested quantifiers, or excessive length.
 * @param pattern The regular expression pattern string to check
 * @returns True if the pattern is flagged as complex, otherwise false
 */
export function isRegexComplex(pattern: string): boolean {
  // 1. Prohibit lookarounds and backreferences
  if (/\(\?\=|\(\?\!/.test(pattern)) return true;
  if (/\(\?\<\=|\(\?\<\!/.test(pattern)) return true;
  if (/\\\d/.test(pattern)) return true;
  
  // 2. Prohibit nested quantifiers in parentheses, e.g. (a+)+
  if (/\([^)]*[\*\+\?][^)]*\)[\*\+\?]/.test(pattern)) return true;

  // 3. Prohibit consecutive repeating quantifiers, e.g., ++, **, +*, *+, etc.
  if (/[\*\+\?]{2,}/.test(pattern)) return true;

  // 4. Prohibit overlapping repeats, e.g., (.*)+ or (a*)+
  if (/\(.*[\*\+\?].*\)[\*\+\?]/.test(pattern)) return true;

  // 5. Restrict regex length
  if (pattern.length > 200) return true;

  return false;
}

/**
 * Validates regular expression triggers of a skill to ensure they are valid and safe against ReDoS.
 * Throws a SkillsMapError if any expression is invalid or too complex.
 * @param regex List of regular expression patterns to validate
 * @param skillId The ID of the skill owning the triggers
 * @param errorCode The exit error code to assign on failure
 */
export function validateRegex(regex: string[], skillId: string, errorCode: number): void {
  for (const reg of regex) {
    if (isRegexComplex(reg)) {
      throw new SkillsMapError(`Config validation failed: triggers/regex "${reg}" in skill "${skillId}" is too complex`, errorCode);
    }
    try {
      new RegExp(reg);
    } catch {
      throw new SkillsMapError(`Config validation failed: triggers/regex "${reg}" in skill "${skillId}" is invalid`, errorCode);
    }
  }
}


/**
 * Performs basic structure type-checks on a parsed configuration object.
 * Validates required properties and trigger parameter types.
 * @param config Parsed configuration object or array to validate
 */
export function validateConfigSchema(config: any): void {
  if (typeof config !== 'object' || config === null) {
    throw new SkillsMapError("Config must be an object", 11);
  }

  let skills = config.skills;
  if (skills === undefined && Array.isArray(config)) {
    skills = config;
  }

  if (!Array.isArray(skills)) {
    throw new SkillsMapError("Config validation failed: /skills must be an array", 11);
  }
  const fallbackNodeId = config.fallbackNodeId;
  if (fallbackNodeId !== undefined && typeof fallbackNodeId !== 'string') {
    throw new SkillsMapError("Config validation failed: /fallbackNodeId must be a string", 11);
  }

  const idPattern = /^[a-zA-Z0-9-_]+$/;
  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    if (typeof s !== 'object' || s === null) {
      throw new SkillsMapError(`Config validation failed: /skills/${i} must be an object`, 11);
    }
    const required = ["id", "name", "description", "path", "tags"];
    for (const req of required) {
      if (s[req] === undefined) {
        throw new SkillsMapError(`Config validation failed: /skills/${i}/${req} is required`, 11);
      }
    }
    if (!idPattern.test(s.id)) {
      throw new SkillsMapError(`Config validation failed: /skills/${i}/id must match pattern ^[a-zA-Z0-9-_]+$`, 11);
    }
    if (typeof s.name !== 'string') {
      throw new SkillsMapError(`Config validation failed: /skills/${i}/name must be a string`, 11);
    }
    if (typeof s.description !== 'string') {
      throw new SkillsMapError(`Config validation failed: /skills/${i}/description must be a string`, 11);
    }
    if (typeof s.path !== 'string') {
      throw new SkillsMapError(`Config validation failed: /skills/${i}/path must be a string`, 11);
    }
    if (!Array.isArray(s.tags) || s.tags.some((t: any) => typeof t !== 'string')) {
      throw new SkillsMapError(`Config validation failed: /skills/${i}/tags must be an array of strings`, 11);
    }
    if (s.dependencies !== undefined && (!Array.isArray(s.dependencies) || s.dependencies.some((d: any) => typeof d !== 'string'))) {
      throw new SkillsMapError(`Config validation failed: /skills/${i}/dependencies must be an array of strings`, 11);
    }
    if (s.priority !== undefined && (typeof s.priority !== 'number' || s.priority < -1.0 || s.priority > 1.0)) {
      throw new SkillsMapError(`Config validation failed: /skills/${i}/priority must be a number between -1.0 and 1.0`, 11);
    }
    if (s.triggers !== undefined) {
      if (typeof s.triggers !== 'object' || s.triggers === null) {
        throw new SkillsMapError(`Config validation failed: /skills/${i}/triggers must be an object`, 11);
      }
      if (s.triggers.regex !== undefined && (!Array.isArray(s.triggers.regex) || s.triggers.regex.some((r: any) => typeof r !== 'string'))) {
        throw new SkillsMapError(`Config validation failed: /skills/${i}/triggers/regex must be an array of strings`, 11);
      }
      if (s.triggers.keywords !== undefined && (!Array.isArray(s.triggers.keywords) || s.triggers.keywords.some((k: any) => typeof k !== 'string'))) {
        throw new SkillsMapError(`Config validation failed: /skills/${i}/triggers/keywords must be an array of strings`, 11);
      }
      if (s.triggers.keywordsMatch !== undefined) {
        const km = s.triggers.keywordsMatch;
        if (typeof km === 'string') {
          if (km !== 'all' && km !== 'any') {
            throw new SkillsMapError(`Config validation failed: /skills/${i}/triggers/keywordsMatch must be "all", "any" or an integer`, 11);
          }
        } else if (typeof km === 'number') {
          if (!Number.isInteger(km) || km < 1) {
            throw new SkillsMapError(`Config validation failed: /skills/${i}/triggers/keywordsMatch must be "all", "any" or an integer >= 1`, 11);
          }
        } else {
          throw new SkillsMapError(`Config validation failed: /skills/${i}/triggers/keywordsMatch must be "all", "any" or an integer`, 11);
        }
      }
    }
  }
}

/**
 * Runs a Depth-First Search (DFS) check to detect dependency cycle loops (DAG validation).
 * Throws a SkillsMapError (error code 12) if a cycle is detected.
 * @param skills List of active skill definitions to evaluate
 */
export function checkCyclicDependencies(skills: SkillNode[]): void {
  const adj: Map<string, string[]> = new Map();
  for (const s of skills) {
    adj.set(s.id, s.dependencies || []);
  }

  const visited: Set<string> = new Set();
  const recStack: Set<string> = new Set();
  const pathStack: string[] = [];

  function dfs(nodeId: string): boolean {
    if (recStack.has(nodeId)) {
      const cycleStartIdx = pathStack.indexOf(nodeId);
      const cyclePath = [...pathStack.slice(cycleStartIdx), nodeId];
      throw new SkillsMapError(`Cycle detected: ${cyclePath.join(' -> ')}`, 12);
    }
    if (visited.has(nodeId)) {
      return false;
    }

    visited.add(nodeId);
    recStack.add(nodeId);
    pathStack.push(nodeId);

    const neighbors = adj.get(nodeId) || [];
    for (const neighbor of neighbors) {
      dfs(neighbor);
    }

    pathStack.pop();
    recStack.delete(nodeId);
    return false;
  }

  for (const s of skills) {
    dfs(s.id);
  }
}

/**
 * Runs a comprehensive configuration validation checking schemas, cycles, missing dependencies, and regex triggers.
 * @param configPath Optional path to the configuration file
 */
export async function validateConfig(configPath?: string): Promise<void> {
  const { skills, fallbackNodeId } = await loadConfig(configPath);

  const skillIds = new Set(skills.map(s => s.id));
  for (const s of skills) {
    if (s.dependencies) {
      for (const dep of s.dependencies) {
        if (!skillIds.has(dep)) {
          throw new SkillsMapError(`Config validation failed: dependency "${dep}" of skill "${s.id}" does not exist`, 11);
        }
      }
    }
  }

  if (fallbackNodeId) {
    const fallbackNode = skills.find(s => s.id === fallbackNodeId);
    if (!fallbackNode) {
      throw new SkillsMapError(`fallbackNodeId "${fallbackNodeId}" does not exist in skills`, 13);
    }
    const adj: Map<string, string[]> = new Map();
    for (const s of skills) {
      adj.set(s.id, s.dependencies || []);
    }
    const visited: Set<string> = new Set();
    const recStack: Set<string> = new Set();
    const dfs = (nodeId: string) => {
      if (recStack.has(nodeId)) {
        throw new SkillsMapError(`fallbackNodeId "${fallbackNodeId}" is part of a cyclic dependency`, 13);
      }
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      recStack.add(nodeId);
      for (const dep of adj.get(nodeId) || []) {
        dfs(dep);
      }
      recStack.delete(nodeId);
    };
    dfs(fallbackNodeId);
  }

  checkCyclicDependencies(skills);

  for (const s of skills) {
    if (s.triggers && s.triggers.regex) {
      validateRegex(s.triggers.regex, s.id, 11);
    }
  }

  const exists = async (p: string) => {
    try {
      await fs.promises.access(p);
      return true;
    } catch {
      return false;
    }
  };

  for (const s of skills) {
    if (!(await exists(s.path))) {
      console.error(`Warning: Entrypoint file inside registered path does not exist for skill "${s.id}": ${s.path}`);
    }
  }
}
