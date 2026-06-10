import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can\'t', 'cannot', 'could', 'couldn\'t',
  'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s',
  'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t',
  'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d',
  'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this',
  'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve',
  'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom',
  'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours',
  'yourself', 'yourselves'
]);

export function getStoreDir(): string {
  if (process.env.SKILLSMAP_STORE_PATH) {
    return path.resolve(process.env.SKILLSMAP_STORE_PATH);
  }
  return path.join(os.homedir(), '.skillsmap');
}

/**
 * @deprecated Use ensureStoreInitializedAsync instead to avoid blocking the event loop.
 */
export function ensureStoreInitialized(customDir?: string): void {
  const storeDir = customDir ? path.resolve(customDir) : getStoreDir();
  const skillsDir = path.join(storeDir, 'skills');
  const registryPath = path.join(storeDir, 'registry.json');
  const mapPath = path.join(storeDir, 'skillsmap.json');
  const indexPath = path.join(storeDir, 'skillsmap.index.json');

  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
  }
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
  if (!fs.existsSync(registryPath)) {
    fs.writeFileSync(registryPath, JSON.stringify({ skills: {} }, null, 2), 'utf8');
  }
  if (!fs.existsSync(mapPath)) {
    fs.writeFileSync(mapPath, JSON.stringify([], null, 2), 'utf8');
  }
  if (!fs.existsSync(indexPath)) {
    const defaultIndex = {
      docCount: 0,
      corpusSize: 0,
      avgDocLength: 0,
      docLengths: {},
      terms: {},
      invertedIndex: {}
    };
    fs.writeFileSync(indexPath, JSON.stringify(defaultIndex, null, 2), 'utf8');
  }
}

export async function ensureStoreInitializedAsync(customDir?: string): Promise<void> {
  const storeDir = customDir ? path.resolve(customDir) : getStoreDir();
  const skillsDir = path.join(storeDir, 'skills');
  const registryPath = path.join(storeDir, 'registry.json');
  const mapPath = path.join(storeDir, 'skillsmap.json');
  const indexPath = path.join(storeDir, 'skillsmap.index.json');

  const exists = async (p: string) => {
    try {
      await fs.promises.access(p);
      return true;
    } catch {
      return false;
    }
  };

  if (!(await exists(storeDir))) {
    await fs.promises.mkdir(storeDir, { recursive: true });
  }
  if (!(await exists(skillsDir))) {
    await fs.promises.mkdir(skillsDir, { recursive: true });
  }
  if (!(await exists(registryPath))) {
    await fs.promises.writeFile(registryPath, JSON.stringify({ skills: {} }, null, 2), 'utf8');
  }
  if (!(await exists(mapPath))) {
    await fs.promises.writeFile(mapPath, JSON.stringify([], null, 2), 'utf8');
  }
  if (!(await exists(indexPath))) {
    const defaultIndex = {
      docCount: 0,
      corpusSize: 0,
      avgDocLength: 0,
      docLengths: {},
      terms: {},
      invertedIndex: {}
    };
    await fs.promises.writeFile(indexPath, JSON.stringify(defaultIndex, null, 2), 'utf8');
  }
}

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 0 && !STOPWORDS.has(token));
}
