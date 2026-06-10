export interface SkillNode {
  id: string;                    // Unique skill identifier (alphanumeric & hyphens)
  name: string;                  // Human-readable label
  description: string;           // Textual description used for BM25 matching
  path: string;                  // Absolute path (computed dynamically on load)
  tags: string[];                // List of keywords for quick matching
  domain: string;                // Category domain for Stage 0 filtering
  category: string;              // Custom secondary classification (free form)
  dependencies?: string[];       // IDs of preceding skills (defines the DAG)
  priority?: number;             // Base scoring weight bias (defaults to 0, range [-1.0, 1.0])
  triggers?: {
    regex?: string[];            // Literal regex patterns for immediate matching
    keywords?: string[];         // Trigger words
    keywordsMatch?: "all" | "any" | number; // Match requirements (default: "any")
  };
}

export interface RouteMatch {
  id: string;
  path: string;
  score: number;
}

export interface RouteResult {
  status: "success" | "no_match";
  match?: RouteMatch;
  matches?: RouteMatch[];
  pathway: string[]; // Dependency chain path to the matched node
  metrics: {
    regexScore: number;
    tagScore: number;
    bm25Score: number;
    executionTimeMs: number;
  };
}

export interface RegistryData {
  skills: {
    [id: string]: {
      source: "git" | "local";
      url?: string;
      localPath?: string;
      installedAt: string;
      version: string;
    };
  };
  domains?: {
    [domainName: string]: string[]; // Custom domains keyword list
  };
}

export class SkillsMapError extends Error {
  constructor(message: string, public exitCode: number) {
    super(message);
    this.name = 'SkillsMapError';
    Object.setPrototypeOf(this, SkillsMapError.prototype);
  }
}

export interface ListItem {
  id: string;
  name: string;
  source: "git" | "local";
  domain: string;
  description: string;
  tags: string[];
  path: string;
  version: string;
  installedAt: string;
}

export interface BM25Index {
  docCount: number;
  avgDocLength: number;
  docLengths: { [docId: string]: number };
  terms: {
    [term: string]: {
      [docId: string]: number; // TF values (term frequency in this doc)
    };
  };
}

