import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { Installer } from './installer';
import { rebuildSkillsMap, buildBM25Index, RegistryManager } from './registry';
import { getStoreDir } from './utils';
import { validateConfig } from './validation';
import { loadConfig } from './config';
import { Router } from './router';
import { startDashboardServer } from './server';
import { SkillsMapError } from './types';

const program = new Command();

program
  .name('skillsmap')
  .description('SkillsMap: ultra-lightweight skills package manager and routing engine')
  .version('0.1.0');

async function handleError(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err: any) {
    if (err instanceof SkillsMapError) {
      console.error(err.message || err);
      process.exit(err.exitCode);
    } else {
      console.error(err.message || err);
      process.exit(1);
    }
  }
}

program
  .command('install')
  .argument('<git-url>', 'Git repository URL to install')
  .description('Install a skill from a remote git repository')
  .action(async (gitUrl) => {
    await handleError(async () => {
      const installer = new Installer();
      await installer.installFromGit(gitUrl);
      console.log(`Successfully installed skill from: ${gitUrl}`);
    });
  });

program
  .command('register')
  .argument('<local-path>', 'Local directory path containing skill.json')
  .description('Register an existing local skill directory')
  .action(async (localPath) => {
    await handleError(async () => {
      const installer = new Installer();
      await installer.registerLocal(localPath);
      console.log(`Successfully registered local skill from: ${localPath}`);
    });
  });

program
  .command('uninstall')
  .argument('<skill-id>', 'ID of the skill to uninstall')
  .description('Uninstall/deregister a skill')
  .option('-f, --force', 'Bypass reverse dependency conflicts check', false)
  .action(async (skillId, options) => {
    await handleError(async () => {
      const installer = new Installer();
      await installer.uninstall(skillId, !!options.force);
      console.log(`Successfully uninstalled skill: ${skillId}`);
    });
  });

program
  .command('list')
  .description('List all registered skills')
  .option('--format <format>', 'Output format: text or json', 'text')
  .option('--domain <domain>', 'Filter skills by domain')
  .action(async (options) => {
    await handleError(async () => {
      const installer = new Installer();
      await installer.list(options.format, options.domain);
    });
  });

program
  .command('validate')
  .description('Validate configuration DAG integrity, cycle checks, fallback paths, and domains')
  .option('-c, --config <path>', 'Custom path to configuration file')
  .action(async (options) => {
    await handleError(async () => {
      await validateConfig(options.config);
      console.log('SkillsMap configuration is valid.');
    });
  });

program
  .command('route')
  .argument('<prompt>', 'User prompt query to match')
  .description('Finds and routes the user prompt to the matched skill')
  .option('-c, --config <path>', 'Custom path to configuration file')
  .option('--top <number>', 'Number of top results to output', '1')
  .option('--format <format>', 'Output format: json or text', 'json')
  .option('--verbose', 'Print debug routing steps to stderr', false)
  .option('-n, --no-cache', 'Bypass disk index and compute index in-memory', false)
  .action(async (prompt, options) => {
    await handleError(async () => {
      await validateConfig(options.config);
      const { skills, fallbackNodeId, domains } = await loadConfig(options.config);
      const router = new Router(skills, fallbackNodeId, domains, options.config);
      const result = await router.route(prompt, {
        top: parseInt(options.top, 10),
        verbose: !!options.verbose,
        noCache: !!options.noCache
      });
      
      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.status === 'success') {
          console.log(`🔍 Matching prompt: "${prompt}"`);
          console.log(`✅ Match Found: ${result.match?.id}`);
          console.log(`   Path: ${result.match?.path}`);
          console.log(`   Total Score: ${result.match?.score.toFixed(2)} (Regex: ${result.metrics.regexScore.toFixed(2)}, Tag: ${result.metrics.tagScore.toFixed(2)}, BM25: ${result.metrics.bm25Score.toFixed(2)})`);
          console.log(`   Routing Pathway: ${result.pathway.join(' -> ')}`);
          console.log(`⏱️  Time: ${result.metrics.executionTimeMs}ms`);
        } else {
          console.log(`🔍 Matching prompt: "${prompt}"`);
          console.log(`❌ No match found.`);
        }
      }
      if (result.status === 'no_match') {
        process.exit(1);
      }
    });
  });

program
  .command('rebuild')
  .description('Rebuild skillsmap and index')
  .action(async () => {
    await handleError(async () => {
      await rebuildSkillsMap(getStoreDir());
      console.log('Successfully rebuilt skillsmap and index.');
    });
  });

program
  .command('index')
  .description('Rebuild index')
  .option('-r, --rebuild', 'Rebuild index file', false)
  .option('-c, --config <path>', 'Custom path to configuration file')
  .action(async (options) => {
    await handleError(async () => {
      const forceRebuild = !!options.rebuild;
      const exists = async (p: string) => {
        try {
          await fs.promises.access(p);
          return true;
        } catch {
          return false;
        }
      };

      if (options.config) {
        await validateConfig(options.config);
        const configPath = path.resolve(options.config);
        const indexPath = path.join(path.dirname(configPath), 'skillsmap.index.json');
        
        let isUpToDate = false;
        if (!forceRebuild && await exists(indexPath)) {
          const configStat = await fs.promises.stat(configPath);
          const indexStat = await fs.promises.stat(indexPath);
          if (indexStat.mtimeMs >= configStat.mtimeMs) {
            isUpToDate = true;
          }
        }

        if (isUpToDate) {
          console.log('Index is up to date.');
          return;
        }

        const { skills } = await loadConfig(configPath);
        const indexData = buildBM25Index(skills);
        await fs.promises.writeFile(indexPath, JSON.stringify(indexData, null, 2), 'utf8');
      } else {
        const storePath = getStoreDir();
        const manager = new RegistryManager(storePath);
        if (!forceRebuild && await manager.isIndexUpToDate(storePath)) {
          console.log('Index is up to date.');
          return;
        }
        await manager.rebuildSkillsMap(storePath);
      }
      console.log(`Successfully rebuilt index${forceRebuild ? ' (forced)' : ''}.`);
    });
  });

program
  .command('init')
  .description('Initialize a template configuration file (skillsmap.json)')
  .option('-c, --config <path>', 'Custom path to write the configuration file to', 'skillsmap.json')
  .action(async (options) => {
    await handleError(async () => {
      const destPath = path.resolve(options.config);
      try {
        await fs.promises.access(destPath);
        throw new SkillsMapError(`Configuration file already exists at: ${destPath}`, 11);
      } catch (err: any) {
        if (err instanceof SkillsMapError) {
          throw err;
        }
        // File does not exist, safe to write
      }

      const template = {
        "$schema": "./node_modules/@skillsmap/core/skillsmap.schema.json",
        "fallbackNodeId": "default-fallback",
        "domains": {
          "coding": ["code", "function", "refactor"],
          "database": ["sql", "query", "mysql"]
        },
        "skills": []
      };

      await fs.promises.writeFile(destPath, JSON.stringify(template, null, 2), 'utf8');
      console.log(`Successfully initialized configuration at: ${destPath}`);
    });
  });

program
  .command('dashboard')
  .description('Start the telemetry dashboard server')
  .option('-p, --port <number>', 'Port to run the dashboard server on', '4500')
  .option('-c, --config <path>', 'Custom path to configuration file')
  .action(async (options) => {
    await handleError(async () => {
      const port = parseInt(options.port, 10) || 4500;
      startDashboardServer(port, options.config);
      await new Promise(() => {});
    });
  });

export const parsePromise = program.parseAsync(process.argv);
