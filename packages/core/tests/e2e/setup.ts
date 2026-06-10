import { beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let currentTempDir: string | null = null;

// Keep track of original values to restore them after each test
const originalEnv = {
  SKILLSMAP_STORE_PATH: process.env.SKILLSMAP_STORE_PATH,
  SKILLSMAP_CONFIG_PATH: process.env.SKILLSMAP_CONFIG_PATH,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  HOMEDRIVE: process.env.HOMEDRIVE,
  HOMEPATH: process.env.HOMEPATH,
};

beforeEach(() => {
  // Create a unique temporary folder for isolation
  const tmpBase = path.join(os.tmpdir(), 'skillsmap-e2e-');
  currentTempDir = fs.mkdtempSync(tmpBase);

  // Set environments for isolation
  process.env.SKILLSMAP_STORE_PATH = currentTempDir;
  process.env.HOME = currentTempDir;
  process.env.USERPROFILE = currentTempDir;
  
  // Delete config path to prevent interference from the environment running the tests
  delete process.env.SKILLSMAP_CONFIG_PATH;
  
  // Delete HOMEDRIVE and HOMEPATH to prevent config leakage to host user's actual home folder
  delete process.env.HOMEDRIVE;
  delete process.env.HOMEPATH;
});

afterEach(() => {
  if (currentTempDir && fs.existsSync(currentTempDir)) {
    try {
      fs.rmSync(currentTempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors during testing
    }
  }

  // Restore env
  if (originalEnv.SKILLSMAP_STORE_PATH !== undefined) {
    process.env.SKILLSMAP_STORE_PATH = originalEnv.SKILLSMAP_STORE_PATH;
  } else {
    delete process.env.SKILLSMAP_STORE_PATH;
  }

  if (originalEnv.SKILLSMAP_CONFIG_PATH !== undefined) {
    process.env.SKILLSMAP_CONFIG_PATH = originalEnv.SKILLSMAP_CONFIG_PATH;
  } else {
    delete process.env.SKILLSMAP_CONFIG_PATH;
  }

  if (originalEnv.HOME !== undefined) {
    process.env.HOME = originalEnv.HOME;
  } else {
    delete process.env.HOME;
  }

  if (originalEnv.USERPROFILE !== undefined) {
    process.env.USERPROFILE = originalEnv.USERPROFILE;
  } else {
    delete process.env.USERPROFILE;
  }

  if (originalEnv.HOMEDRIVE !== undefined) {
    process.env.HOMEDRIVE = originalEnv.HOMEDRIVE;
  } else {
    delete process.env.HOMEDRIVE;
  }

  if (originalEnv.HOMEPATH !== undefined) {
    process.env.HOMEPATH = originalEnv.HOMEPATH;
  } else {
    delete process.env.HOMEPATH;
  }

  currentTempDir = null;
});
