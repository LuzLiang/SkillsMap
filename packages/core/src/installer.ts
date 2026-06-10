import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { RegistryManager } from './registry';
import { SkillsMapError, ListItem } from './types';
import { getStoreDir, ensureStoreInitializedAsync } from './utils';
import { validateConfigSchema, validateRegex } from './validation';

const execFileAsync = promisify(execFile);

const exists = async (p: string) => {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Installer handles installation of remote Git skills and local folder registrations.
 */
export class Installer {
  private storeDir: string;
  private registryManager: RegistryManager;

  /**
   * Creates an instance of Installer.
   * @param targetDir Optional custom database store directory (defaults to ~/.skillsmap)
   */
  constructor(targetDir?: string) {
    this.storeDir = targetDir || getStoreDir();
    this.registryManager = new RegistryManager(this.storeDir);
  }

  getTargetDir(): string {
    return this.storeDir;
  }

  /**
   * Clones and registers a remote skill from a Git repository or file URL.
   * @param gitUrl Whitelisted repository clone endpoint
   */
  async installFromGit(gitUrl: string): Promise<void> {
    await ensureStoreInitializedAsync(this.storeDir);

    // 1. Git URL Whitelisting
    const gitUrlRegex = /^(https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?|git@github\.com:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?)$/;
    const isGitUrlWhitelisted = gitUrlRegex.test(gitUrl);
    
    let isLocalDir = false;
    if (await exists(gitUrl)) {
      const stat = await fs.promises.stat(gitUrl);
      isLocalDir = stat.isDirectory();
    }

    let isLocalFileUrl = false;
    if (gitUrl.startsWith('file://')) {
      try {
        const localPath = fileURLToPath(gitUrl);
        if (await exists(localPath)) {
          const stat = await fs.promises.stat(localPath);
          if (stat.isDirectory()) {
            isLocalFileUrl = true;
          }
        }
      } catch {
        // ignore
      }
    }
    if (!isGitUrlWhitelisted && !isLocalDir && !isLocalFileUrl) {
      throw new SkillsMapError("Git clone failed: Invalid or forbidden Git URL", 20);
    }

    const tempDirName = `git-temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const tempDirPath = path.join(this.storeDir, 'skills', tempDirName);

    // Path traversal check for temporary path
    const resolvedTempPath = path.resolve(tempDirPath);
    const skillsBaseDir = path.resolve(path.join(this.storeDir, 'skills'));
    if (!resolvedTempPath.startsWith(skillsBaseDir + path.sep)) {
      throw new SkillsMapError("Path traversal detected in temporary path", 20);
    }

    try {
      await execFileAsync('git', ['clone', '--depth', '1', gitUrl, tempDirPath], {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'true'
        }
      });
    } catch {
      if (await exists(tempDirPath)) {
        await fs.promises.rm(tempDirPath, { recursive: true, force: true });
      }
      throw new SkillsMapError("Git clone failed", 20);
    }

    const skillJsonPath = path.join(tempDirPath, 'skill.json');
    if (!(await exists(skillJsonPath))) {
      if (await exists(tempDirPath)) {
        await fs.promises.rm(tempDirPath, { recursive: true, force: true });
      }
      throw new SkillsMapError("Missing skill.json", 21);
    }

    let skillId: string;
    let version: string;
    let entrypoint: string;
    let parsed: any;

    try {
      const rawContent = await fs.promises.readFile(skillJsonPath, 'utf8');
      try {
        parsed = JSON.parse(rawContent);
      } catch (jsonErr: any) {
        throw new SkillsMapError(`Config parsing failed: ${jsonErr.message}`, 10);
      }

      try {
        validateConfigSchema({ skills: [parsed] });
      } catch (valErr: any) {
        throw new SkillsMapError(`validation failed: ${valErr.message}`, 11);
      }

      if (parsed.triggers && parsed.triggers.regex) {
        validateRegex(parsed.triggers.regex, parsed.id, 11);
      }

      skillId = parsed.id;
      version = parsed.version || '0.1.0';
      entrypoint = parsed.path;
    } catch (err) {
      if (await exists(tempDirPath)) {
        await fs.promises.rm(tempDirPath, { recursive: true, force: true });
      }
      throw err;
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(skillId)) {
      if (await exists(tempDirPath)) {
        await fs.promises.rm(tempDirPath, { recursive: true, force: true });
      }
      throw new SkillsMapError(`Invalid skill ID format: ${skillId}`, 11);
    }

    const targetPath = path.join(this.storeDir, 'skills', skillId);
    const resolvedTargetPath = path.resolve(targetPath);
    if (!resolvedTargetPath.startsWith(skillsBaseDir + path.sep)) {
      if (await exists(tempDirPath)) {
        await fs.promises.rm(tempDirPath, { recursive: true, force: true });
      }
      throw new SkillsMapError("Path traversal detected in target path", 11);
    }

    try {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    } catch {
      // Ignore errors if it doesn't exist
    }
    await fs.promises.rename(tempDirPath, targetPath);

    const entrypointPath = path.join(targetPath, entrypoint);
    if (!(await exists(entrypointPath))) {
      console.warn(`Warning: Entrypoint file inside registered path does not exist: ${entrypointPath}`);
    }

    await this.registryManager.registerSkill(skillId, 'git', gitUrl, version);
  }

  /**
   * Registers a local development skill directory using filesystem junctions/symlinks.
   * @param localPath Relative or absolute folder path
   */
  async registerLocal(localPath: string): Promise<void> {
    await ensureStoreInitializedAsync(this.storeDir);
    const absoluteLocalPath = path.resolve(localPath);
    if (!(await exists(absoluteLocalPath))) {
      throw new SkillsMapError(`Local directory not found: ${absoluteLocalPath}`, 21);
    }

    // Path traversal / permitted sandbox check
    const rootPath = path.parse(absoluteLocalPath).root;
    if (absoluteLocalPath === rootPath) {
      throw new SkillsMapError(`Cannot register root directory as local skill: ${absoluteLocalPath}`, 21);
    }
    const storeResolved = path.resolve(this.storeDir);
    const skillsResolved = path.resolve(path.join(this.storeDir, 'skills'));
    if (absoluteLocalPath === storeResolved || absoluteLocalPath === skillsResolved) {
      throw new SkillsMapError(`Cannot register store or skills directory itself: ${absoluteLocalPath}`, 21);
    }

    const skillJsonPath = path.join(absoluteLocalPath, 'skill.json');
    if (!(await exists(skillJsonPath))) {
      throw new SkillsMapError("Missing skill.json", 21);
    }

    let skillId: string;
    let version: string;
    let entrypoint: string;
    let parsed: any;

    const rawContent = await fs.promises.readFile(skillJsonPath, 'utf8');
    try {
      parsed = JSON.parse(rawContent);
    } catch (jsonErr: any) {
      throw new SkillsMapError(`Config parsing failed: ${jsonErr.message}`, 10);
    }

    try {
      validateConfigSchema({ skills: [parsed] });
    } catch (valErr: any) {
      throw new SkillsMapError(`validation failed: ${valErr.message}`, 21);
    }

    if (parsed.triggers && parsed.triggers.regex) {
      validateRegex(parsed.triggers.regex, parsed.id, 21);
    }

    skillId = parsed.id;
    version = parsed.version || '0.1.0';
    entrypoint = parsed.path;

    if (!/^[a-zA-Z0-9-_]+$/.test(skillId)) {
      throw new SkillsMapError(`Invalid skill ID format: ${skillId}`, 21);
    }

    const entrypointPath = path.join(absoluteLocalPath, entrypoint);
    if (!(await exists(entrypointPath))) {
      console.warn(`Warning: Entrypoint file inside registered path does not exist: ${entrypointPath}`);
    }

    const targetLinkPath = path.join(this.storeDir, 'skills', skillId);
    const resolvedLinkPath = path.resolve(targetLinkPath);
    const skillsBaseDir = path.resolve(path.join(this.storeDir, 'skills'));
    if (!resolvedLinkPath.startsWith(skillsBaseDir + path.sep)) {
      throw new SkillsMapError("Path traversal detected in registration path", 21);
    }

    try {
      await fs.promises.rm(targetLinkPath, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.promises.symlink(absoluteLocalPath, targetLinkPath, linkType);

    await this.registryManager.registerSkill(skillId, 'local', absoluteLocalPath, version);
  }

  /**
   * Uninstalls/deregisters a skill by ID and performs dependency resolution check.
   * @param skillId The unique ID of the target skill to remove
   * @param force Skip checking for dependency conflicts
   */
  async uninstall(skillId: string, force: boolean = false): Promise<void> {
    await ensureStoreInitializedAsync(this.storeDir);
    if (skillId.includes('..') || skillId.includes('/') || skillId.includes('\\')) {
      throw new SkillsMapError(`Path traversal detected in skill ID: ${skillId}`, 22);
    }

    const registry = await this.registryManager.load();
    if (!registry.skills || !registry.skills[skillId]) {
      throw new SkillsMapError(`Skill ${skillId} is not installed`, 22);
    }

    const dependents: string[] = [];
    for (const [id, details] of Object.entries(registry.skills)) {
      if (id === skillId) continue;
      
      const dirPath = details.source === 'local' 
        ? path.resolve(details.localPath!) 
        : path.resolve(this.storeDir, 'skills', id);

      const skillJsonPath = path.join(dirPath, 'skill.json');
      if (await exists(skillJsonPath)) {
        try {
          const rawContent = await fs.promises.readFile(skillJsonPath, 'utf8');
          const config = JSON.parse(rawContent);
          if (config.dependencies && config.dependencies.includes(skillId)) {
            dependents.push(id);
          }
        } catch (err: any) {
          console.error(`Warning: Failed to parse skill.json for skill "${id}": ${err.message}`);
        }
      }
    }

    if (dependents.length > 0) {
      if (!force) {
        throw new SkillsMapError(
          `Dependency conflict: Cannot uninstall ${skillId} because other skills depend on it: ${dependents.join(', ')}`,
          22
        );
      } else {
        console.warn(`Warning: overriding dependency conflicts. The following skills depend on '${skillId}': ${dependents.join(', ')}`);
      }
    }

    const skillPath = path.join(this.storeDir, 'skills', skillId);
    let resolvedSkillPath = '';
    try {
      resolvedSkillPath = path.resolve(skillPath);
    } catch {
      // ignore
    }

    if (resolvedSkillPath) {
      const skillsBaseDir = path.resolve(path.join(this.storeDir, 'skills'));
      if (!resolvedSkillPath.startsWith(skillsBaseDir + path.sep)) {
        throw new SkillsMapError("Path traversal detected in uninstall path", 22);
      }
    }

    try {
      await fs.promises.rm(skillPath, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    await this.registryManager.unregisterSkill(skillId);
  }

  /**
   * Lists all registered skills formatted as text stdout or raw JSON array.
   * @param format Output mode: 'text' or 'json'
   * @param domainFilter Filter results by specific domain classification
   * @returns Array of active list item structures
   */
  async list(format: string, domainFilter?: string): Promise<ListItem[]> {
    await ensureStoreInitializedAsync(this.storeDir);
    const registry = await this.registryManager.load();
    const listItems: ListItem[] = [];

    for (const [id, details] of Object.entries(registry.skills || {})) {
      const dirPath = details.source === 'local' 
        ? path.resolve(details.localPath!) 
        : path.resolve(this.storeDir, 'skills', id);

      const skillJsonPath = path.join(dirPath, 'skill.json');
      let name = '';
      let domain = '';
      let description = '';
      let tags: string[] = [];

      if (await exists(skillJsonPath)) {
        try {
          const rawContent = await fs.promises.readFile(skillJsonPath, 'utf8');
          const config = JSON.parse(rawContent);
          name = config.name || '';
          domain = config.domain || '';
          description = config.description || '';
          tags = config.tags || [];
        } catch {
          // ignore parsing error
        }
      }

      if (domainFilter && domain.toLowerCase() !== domainFilter.toLowerCase()) {
        continue;
      }

      listItems.push({
        id,
        name,
        source: details.source,
        domain,
        description,
        tags,
        path: details.source === 'local' ? details.localPath! : dirPath,
        version: details.version,
        installedAt: details.installedAt
      });
    }

    if (format === 'json') {
      console.log(JSON.stringify(listItems, null, 2));
    } else {
      if (listItems.length === 0) {
        console.log('No skills found.');
        return listItems;
      }

      const headers = ['ID', 'Name', 'Domain', 'Source', 'Version', 'Path'];
      const columnWidths = [15, 20, 15, 10, 10, 40];

      listItems.forEach(item => {
        columnWidths[0] = Math.max(columnWidths[0], (item.id || '').length);
        columnWidths[1] = Math.max(columnWidths[1], (item.name || '').length);
        columnWidths[2] = Math.max(columnWidths[2], (item.domain || '').length);
        columnWidths[3] = Math.max(columnWidths[3], (item.source || '').length);
        columnWidths[4] = Math.max(columnWidths[4], (item.version || '').length);
        columnWidths[5] = Math.max(columnWidths[5], (item.path || '').length);
      });

      const printRow = (cells: string[]) => {
        return cells.map((cell, idx) => cell.padEnd(columnWidths[idx])).join(' | ');
      };

      console.log(printRow(headers));
      console.log('-'.repeat(columnWidths.reduce((a, b) => a + b, 0) + (headers.length - 1) * 3));
      listItems.forEach(item => {
        console.log(printRow([
          item.id,
          item.name || '',
          item.domain || '',
          item.source || '',
          item.version || '',
          item.path || ''
        ]));
      });
    }

    return listItems;
  }
}

