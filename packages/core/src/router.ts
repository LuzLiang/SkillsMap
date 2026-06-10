import * as fs from 'fs';
import * as path from 'path';
import { SkillNode, RouteResult, BM25Index } from './types';
import { getStoreDir, tokenize } from './utils';
import { buildBM25Index } from './registry';

const DEFAULT_DOMAINS: Record<string, string[]> = {
  coding: ["code", "function", "class", "refactor", "typescript", "javascript", "python", "compile", "bug", "write", "programming"],
  sysadmin: ["terminal", "bash", "shell", "process", "directory", "kill", "ps", "exec", "chmod", "system", "command", "run"],
  database: ["sql", "database", "query", "mysql", "postgres", "mongodb", "db", "select", "insert", "update", "delete", "table"],
  testing: ["test", "vitest", "jest", "unittest", "assert", "coverage", "benchmark", "verify"],
  documentation: ["markdown", "doc", "wiki", "readme", "comment", "api", "writeup", "document"],
  communication: ["chat", "slack", "message", "email", "notify", "teams", "send", "channel"],
  science: ["biology", "chemistry", "gene", "protein", "dna", "molecule", "uniprot", "pdb", "arxiv", "paper"],
  browser: ["browser", "web", "scrape", "http", "fetch", "html", "url", "navigate", "click"],
  vcs: ["git", "branch", "commit", "merge", "repo", "github", "gitlab", "checkout", "pull", "push", "clone", "rebase"],
  cloud: ["docker", "k8s", "kubernetes", "aws", "gcp", "azure", "deployment", "cicd", "pipeline", "container"],
  ai: ["prompt", "embedding", "vector", "openai", "gemini", "claude", "agent", "llm", "model"],
  security: ["security", "vuln", "scan", "credential", "encrypt", "decrypt", "cipher", "auth", "token", "login"]
};

/**
 * Router engine for evaluating and routing prompts to matching skills.
 */
export class Router {
  private skills: SkillNode[];
  private fallbackNodeId?: string;
  private domains: Record<string, Set<string>>;
  private configPath?: string;
  private weights = {
    regex: 1.0,
    tag: 0.4,
    bm25: 0.5,
    priority: 0.1
  };

  /**
   * Creates an instance of Router.
   * @param skills List of skill definitions to route against
   * @param fallbackNodeId Default fallback skill ID if no route match succeeds
   * @param domains Custom domain classification keywords
   * @param configPath Path to the skillsmap configuration file
   * @param weights Custom scoring weights for the 4-stage pipeline
   */
  constructor(
    skills: SkillNode[] = [],
    fallbackNodeId?: string,
    domains?: Record<string, string[]>,
    configPath?: string,
    weights?: { regex?: number; tag?: number; bm25?: number; priority?: number }
  ) {
    this.skills = skills;
    this.fallbackNodeId = fallbackNodeId;
    const mergedDomains = { ...DEFAULT_DOMAINS, ...domains };
    this.domains = {};
    for (const [name, kws] of Object.entries(mergedDomains)) {
      this.domains[name] = new Set(kws.map(k => k.toLowerCase()));
    }
    this.configPath = configPath;
    if (weights) {
      this.weights = { ...this.weights, ...weights };
    }
  }

  /**
   * Dynamically routes the user prompt through the 4-stage matching pipeline.
   * @param prompt The user query or prompt string
   * @param options Routing evaluation options
   * @returns Resolves with the RouteResult containing matches, pathway and execution metrics
   */
  async route(prompt: string, options: { top?: number; verbose?: boolean; noCache?: boolean } = {}): Promise<RouteResult> {
    const startTime = Date.now();
    const top = options.top || 1;

    const promptTokens = tokenize(prompt);

    if (!prompt || prompt.trim() === '' || promptTokens.length === 0) {
      if (options.verbose) {
        process.stderr.write(`[Router] Empty or stopword-only prompt. Routing directly to fallback or no-match.\n`);
      }
      return this.fallbackOrNoMatch(startTime);
    }

    if (this.skills.length === 0) {
      if (options.verbose) {
        process.stderr.write(`[Router] No skills registered. Routing directly to fallback or no-match.\n`);
      }
      return this.fallbackOrNoMatch(startTime);
    }

    // ────────────────────────────────────────────────────────────────
    // STAGE 0: Domain Pre-Classification
    // ────────────────────────────────────────────────────────────────
    const activeDomains: Set<string> = new Set();
    for (const [domainName, keywordSet] of Object.entries(this.domains)) {
      const matchCount = promptTokens.filter(t => keywordSet.has(t)).length;
      if (matchCount >= 1) {
        activeDomains.add(domainName);
      }
    }

    let candidateSkills = this.skills;
    if (activeDomains.size > 0) {
      candidateSkills = this.skills.filter(s => s.domain && activeDomains.has(s.domain));
      if (candidateSkills.length === 0) {
        candidateSkills = this.skills; // Fallback to all if no candidates left
      }
    }

    if (options.verbose) {
      process.stderr.write(`[Router] Routing prompt: "${prompt}"\n`);
      process.stderr.write(`[Router] Tokenized prompt: [${promptTokens.join(', ')}]\n`);
      process.stderr.write(`[Router] Active domains: [${Array.from(activeDomains).join(', ')}]\n`);
      process.stderr.write(`[Router] Candidate skills count: ${candidateSkills.length}\n`);
    }

    const scoredMatches: { node: SkillNode; index: number; scores: { regex: number; tag: number; bm25: number; priority: number } }[] = [];

    // Load BM25 Index
    const bm25Index = await this.loadOrBuildBM25Index(options.noCache);

    // Evaluate candidates
    for (let idx = 0; idx < candidateSkills.length; idx++) {
      const s = candidateSkills[idx];

      // STAGE 1: Regex Matcher
      let regexScore = 0;
      if (prompt.length <= 500 && s.triggers?.regex) {
        for (const regStr of s.triggers.regex) {
          try {
            const rx = new RegExp(regStr, 'i');
            if (rx.test(prompt)) {
              regexScore = 1.0;
              break;
            }
          } catch {
            // Ignore invalid regex
          }
        }
      }

      // STAGE 2: Keyword & Tag Matcher
      let tagScore = 0;
      let passesKeywords = true;

      // Keyword Filter
      if (s.triggers?.keywords && s.triggers.keywords.length > 0) {
        const kwMatch = s.triggers.keywordsMatch || 'any';
        const lowercasePrompt = prompt.toLowerCase();
        const kwMatches = s.triggers.keywords.filter(k => lowercasePrompt.includes(k.toLowerCase())).length;

        if (kwMatch === 'all') {
          passesKeywords = kwMatches === s.triggers.keywords.length;
        } else if (kwMatch === 'any') {
          passesKeywords = kwMatches > 0;
        } else if (typeof kwMatch === 'number') {
          passesKeywords = kwMatches >= kwMatch;
        }
      }

      if (options.verbose) {
        process.stderr.write(`[Router] Evaluating skill "${s.id}":\n`);
        process.stderr.write(`  - Regex Score: ${regexScore}\n`);
        process.stderr.write(`  - Passes Keywords: ${passesKeywords}\n`);
      }

      if (!passesKeywords) {
        continue;
      }

      // Tag overlap score
      if (s.tags && s.tags.length > 0) {
        const tagTokens = s.tags.map(t => t.toLowerCase());
        const intersection = promptTokens.filter(t => tagTokens.includes(t)).length;
        tagScore = Math.sqrt(intersection / tagTokens.length);
      }

      // STAGE 3: BM25 Matcher
      let bm25Score = 0;
      if (bm25Index && bm25Index.docCount > 0) {
        let rawBM25 = 0;
        let maxBM25 = 0;
        const k1 = 1.2;
        const b = 0.75;
        const N = bm25Index.docCount;
        const avgdl = bm25Index.avgDocLength;

        for (const qTerm of promptTokens) {
          // Calculate IDF
          const termDocs = bm25Index.terms[qTerm] || {};
          const df = Object.keys(termDocs).length;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

          maxBM25 += idf * (k1 + 1);

          if (termDocs[s.id]) {
            const tf = termDocs[s.id];
            const docLen = bm25Index.docLengths[s.id] || 0;
            const dlRatio = avgdl > 0 ? docLen / avgdl : 0;
            const termBM25 = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dlRatio));
            rawBM25 += termBM25;
          }
        }

        bm25Score = maxBM25 > 0 ? rawBM25 / maxBM25 : 0;
      }

      if (options.verbose) {
        process.stderr.write(`  - Tag Score: ${tagScore}\n`);
        process.stderr.write(`  - BM25 Score: ${bm25Score}\n`);
      }

      scoredMatches.push({
        node: s,
        index: idx,
        scores: {
          regex: regexScore,
          tag: tagScore,
          bm25: bm25Score,
          priority: s.priority || 0
        }
      });
    }

    if (scoredMatches.length === 0) {
      if (options.verbose) {
        process.stderr.write(`[Router] No candidate matches met the keyword criteria.\n`);
      }
      return this.fallbackOrNoMatch(startTime);
    }

    // STAGE 4: Combined Score & Clamping + Tie-Breaking
    const results = scoredMatches.map(m => {
      const rawScore = 
        (this.weights.regex * m.scores.regex) + 
        (this.weights.tag * m.scores.tag) + 
        (this.weights.bm25 * m.scores.bm25) + 
        (this.weights.priority * m.scores.priority);
      const finalScore = Math.min(1.0, Math.max(0.0, rawScore));
      return {
        node: m.node,
        index: m.index,
        score: finalScore,
        metrics: m.scores
      };
    });

    // Sort descending by score, tie-breaker on priority, then index (definition order)
    results.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 1e-9) {
        return b.score - a.score;
      }
      if (Math.abs(a.metrics.priority - b.metrics.priority) > 1e-9) {
        return b.metrics.priority - a.metrics.priority;
      }
      return a.index - b.index;
    });

    if (options.verbose) {
      process.stderr.write(`[Router] Combined & Sorted Candidates:\n`);
      for (const r of results) {
        process.stderr.write(`  - ${r.node.id}: score=${r.score.toFixed(4)} (regex=${r.metrics.regex.toFixed(4)}, tag=${r.metrics.tag.toFixed(4)}, bm25=${r.metrics.bm25.toFixed(4)}, priority=${r.metrics.priority.toFixed(4)})\n`);
      }
    }

    const bestMatch = results[0];

    // Check if best match meets threshold (> 0)
    if (bestMatch.score <= 0.0) {
      if (options.verbose) {
        process.stderr.write(`[Router] Selected Match: None (No candidate met score threshold > 0.0)\n`);
      }
      return this.fallbackOrNoMatch(startTime);
    }

    if (options.verbose) {
      process.stderr.write(`[Router] Selected Match: "${bestMatch.node.id}" (Score: ${bestMatch.score.toFixed(4)})\n`);
    }

    const pathway = getDependencyPathway(bestMatch.node.id, this.skills);

    const topMatches = results.slice(0, top).map(r => ({
      id: r.node.id,
      path: r.node.path,
      score: r.score
    }));

    return {
      status: "success",
      match: topMatches[0],
      matches: topMatches,
      pathway,
      metrics: {
        regexScore: bestMatch.metrics.regex,
        tagScore: bestMatch.metrics.tag,
        bm25Score: bestMatch.metrics.bm25,
        executionTimeMs: Date.now() - startTime
      }
    };
  }

  private fallbackOrNoMatch(startTime: number): RouteResult {
    if (this.fallbackNodeId) {
      const fallbackNode = this.skills.find(s => s.id === this.fallbackNodeId);
      if (fallbackNode) {
        const pathway = getDependencyPathway(fallbackNode.id, this.skills);
        const fm = {
          id: fallbackNode.id,
          path: fallbackNode.path,
          score: 0.0
        };
        return {
          status: "success",
          match: fm,
          matches: [fm],
          pathway,
          metrics: {
            regexScore: 0,
            tagScore: 0,
            bm25Score: 0,
            executionTimeMs: Date.now() - startTime
          }
        };
      }
    }

    return {
      status: "no_match",
      pathway: [],
      metrics: {
        regexScore: 0,
        tagScore: 0,
        bm25Score: 0,
        executionTimeMs: Date.now() - startTime
      }
    };
  }

  private async loadOrBuildBM25Index(noCache?: boolean): Promise<BM25Index | null> {
    let indexPath = '';
    if (this.configPath) {
      indexPath = path.join(path.dirname(path.resolve(this.configPath)), 'skillsmap.index.json');
    } else {
      indexPath = path.join(getStoreDir(), 'skillsmap.index.json');
    }

    const exists = async (p: string) => {
      try {
        await fs.promises.access(p);
        return true;
      } catch {
        return false;
      }
    };

    if (!noCache && await exists(indexPath)) {
      try {
        const configPathToCheck = this.configPath || path.join(getStoreDir(), 'skillsmap.json');
        if (await exists(configPathToCheck)) {
          const configStat = await fs.promises.stat(configPathToCheck);
          const indexStat = await fs.promises.stat(indexPath);
          if (configStat.mtimeMs > indexStat.mtimeMs) {
            throw new Error('Index file is outdated');
          }
        }

        const content = await fs.promises.readFile(indexPath, 'utf8');
        const index = JSON.parse(content) as BM25Index;

        if (index.docCount !== this.skills.length) {
          throw new Error('Index document count mismatch');
        }

        return index;
      } catch {
        // Fallback to in-memory rebuild
      }
    }

    return buildBM25Index(this.skills);
  }
}

/**
 * Computes the dependency pathway for a matched skill.
 * @param matchedId The ID of the matched skill
 * @param skills List of all active skill definitions
 * @returns Array of skill IDs representing the dependency chain
 */
export function getDependencyPathway(matchedId: string, skills: SkillNode[]): string[] {
  const nodeMap = new Map<string, SkillNode>();
  for (const s of skills) {
    nodeMap.set(s.id, s);
  }

  const visited = new Set<string>();
  const pathwayStack: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const node = nodeMap.get(id);
    if (node && node.dependencies) {
      for (const dep of node.dependencies) {
        visit(dep);
      }
    }
    pathwayStack.push(id);
  }

  visit(matchedId);
  return pathwayStack;
}
