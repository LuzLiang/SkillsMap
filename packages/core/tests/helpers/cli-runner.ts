import { execaNode } from 'execa';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the path to the built CLI entry point
const CLI_PATH = resolve(__dirname, '../../dist/cli.js');

export interface RunCliOptions {
  env?: Record<string, string>;
  cwd?: string;
  reject?: boolean;
  cliPath?: string;
}

/**
 * Runs the SkillsMap CLI binary with correct environment overrides for E2E tests.
 * 
 * @param args - Command line arguments to pass to the CLI.
 * @param options - Custom environment variables, working directory, and execution options.
 * @returns Execa promise containing stdout, stderr, exitCode, etc.
 */
export function runCli(args: string[], options: RunCliOptions = {}) {
  const storePath = process.env.SKILLSMAP_STORE_PATH;
  
  const env = {
    ...process.env,
    ...(storePath ? {
      SKILLSMAP_STORE_PATH: storePath,
      HOME: storePath,
      USERPROFILE: storePath,
    } : {}),
    ...options.env,
  };

  const targetPath = options.cliPath || CLI_PATH;

  return execaNode(targetPath, args, {
    cwd: options.cwd || process.cwd(),
    env,
    reject: options.reject ?? false,
  });
}
