<p align="center">
  <h1 align="center">SkillsMap</h1>
  <p align="center">🗺️ The skill router your AI agent actually needs</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-98.9%25-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License">
  <img src="https://img.shields.io/badge/Tests-94%2F94-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/Coverage-95%25-28a745" alt="Coverage">
  <img src="https://img.shields.io/badge/p50-0.89ms-blueviolet" alt="Latency">
</p>

---

## The Problem

Your AI agent has 50 skills. Every time a user sends a prompt, you're loading all 50 into context — burning tokens, wasting memory, and confusing the model.

**SkillsMap fixes this.** It's a lightweight router that takes a user prompt and returns the single best-matching skill in under 1ms. No LLM calls. No embeddings. Pure deterministic scoring.

```
User: "deploy my app to AWS"

Without SkillsMap:  Load all 50 skills into context     → 12,000 tokens
With SkillsMap:     skillsmap route "deploy my app to AWS" → "deploy-aws" (0.94, 0.89ms)
```

## How It Works

A 4-stage pipeline filters and scores every registered skill against the user's prompt:

```
                         ┌─────────────────────┐
                         │    User Prompt       │
                         └──────────┬──────────┘
                                    │
                         ┌──────────▼──────────┐
                    ┌────│  Stage 0: Domain     │────┐
                    │    │  O(1) Set lookup     │    │
                    │    └──────────┬──────────┘    │
                    │  80% eliminated                │
                    │    ┌──────────▼──────────┐    │
                    │    │  Stage 1: Regex      │    │
                    │    │  Instant triggers    │    │
                    │    └──────────┬──────────┘    │
                    │    ┌──────────▼──────────┐    │
                    │    │  Stage 2: Tag Match  │    │
                    │    │  √(overlap/|tags|)   │    │
                    │    └──────────┬──────────┘    │
                    │    ┌──────────▼──────────┐    │
                    │    │  Stage 3: BM25       │    │
                    │    │  Document ranking    │    │
                    │    └──────────┬──────────┘    │
                    │               │                │
                    │    ┌──────────▼──────────┐    │
                    └───►│  Combined Score      │◄───┘
                         │  + Tie-breaking      │
                         └──────────┬──────────┘
                                    │
                         ┌──────────▼──────────┐
                         │  Best Match → Path   │
                         └─────────────────────┘
```

## Quick Start (< 60 seconds)

```bash
# Install
npm install -g @skillsmap/core

# Register a local skill
skillsmap register ./my-skills/git-helper

# Or install from GitHub
skillsmap install https://github.com/user/skill-git.git

# Route a prompt
skillsmap route "help me rebase my git branch"
# → ✅ Match Found: git-helper (score: 0.92, 0.7ms)
```

## CLI Commands

| Command | Description |
|:---|:---|
| `skillsmap install <git-url>` | Install a skill from a Git repository |
| `skillsmap register <path>` | Register a local skill directory |
| `skillsmap uninstall <id> [-f]` | Uninstall (with dependency conflict check) |
| `skillsmap list [--format json] [--domain <x>]` | List all registered skills |
| `skillsmap route "<prompt>" [--top N] [--verbose]` | Route a prompt to the best skill |
| `skillsmap validate [-c <path>]` | Validate config DAG integrity |
| `skillsmap index [-r]` | Rebuild BM25 index (incremental by default) |
| `skillsmap init` | Generate a template `skillsmap.json` |
| `skillsmap dashboard [-p 4500]` | Start the telemetry cockpit server |

## Define a Skill

Each skill is a folder with a `skill.json`:

```json
{
  "id": "deploy-aws",
  "name": "Deploy to AWS",
  "description": "Deploys containerized apps to AWS ECS or Lambda",
  "path": "./index.js",
  "tags": ["aws", "deploy", "ecs", "lambda", "cloud"],
  "domain": "cloud",
  "category": "devops",
  "priority": 0.3,
  "dependencies": ["dockerize"],
  "triggers": {
    "regex": ["^deploy.*aws$"],
    "keywords": ["aws", "deploy"],
    "keywordsMatch": "any"
  }
}
```

<details>
<summary><strong>Full schema reference (click to expand)</strong></summary>

| Field | Type | Required | Description |
|:---|:---|:---:|:---|
| `id` | `string` | ✅ | Unique identifier (alphanumeric, hyphens, underscores) |
| `name` | `string` | ✅ | Human-readable label |
| `description` | `string` | ✅ | Used for BM25 semantic matching |
| `path` | `string` | ✅ | Relative path to the skill entrypoint |
| `tags` | `string[]` | ✅ | Keywords for tag overlap scoring |
| `domain` | `string` | | Category domain for Stage 0 filtering |
| `category` | `string` | | Free-form secondary classification |
| `dependencies` | `string[]` | | Skill IDs that must run first (DAG) |
| `priority` | `number` | | Score bias [-1.0, 1.0] (default: 0) |
| `triggers.regex` | `string[]` | | Literal regex patterns (ReDoS-safe) |
| `triggers.keywords` | `string[]` | | Required keywords for matching |
| `triggers.keywordsMatch` | `"all" \| "any" \| number` | | Match mode (default: `"any"`) |

</details>

## SDK Usage

```typescript
import { Router, Installer } from '@skillsmap/core';

// ── Routing ──────────────────────────────────────────
const router = new Router(skills, 'fallback-id');
const result = await router.route('deploy to aws', { top: 3, verbose: true });

console.log(result.match.id);      // "deploy-aws"
console.log(result.match.score);   // 0.94
console.log(result.pathway);       // ["dockerize", "deploy-aws"]
console.log(result.metrics);       // { regexScore, tagScore, bm25Score, executionTimeMs }

// ── Package Management ───────────────────────────────
const installer = new Installer();
await installer.installFromGit('https://github.com/user/skill.git');
await installer.registerLocal('./my-local-skill');
const skills = await installer.list('json');
```

## Configuration

SkillsMap uses a dual-layer configuration system:

1. **Global** (`~/.skillsmap/skillsmap.json`) — auto-generated from installed skills
2. **Project** (`./skillsmap.json`) — optional, can `extends` the global config

```json
{
  "$schema": "node_modules/@skillsmap/core/skillsmap.schema.json",
  "extends": true,
  "fallbackNodeId": "general-helper",
  "domains": {
    "gamedev": ["unity", "unreal", "godot", "sprite"]
  },
  "skills": [...]
}
```

Config discovery order: `--config` flag → `$SKILLSMAP_CONFIG_PATH` → `./skillsmap.json` → `~/.skillsmap/skillsmap.json`

## Performance

Benchmarked on 100 registered skills:

| Metric | Result |
|:---|:---|
| p50 latency | **0.89ms** |
| p99 latency | **2.32ms** |
| Cold start memory | **< 15MB** |

Run benchmarks yourself:

```bash
pnpm bench
```

## Security

- **Git URL whitelisting** — only GitHub HTTPS/SSH URLs allowed
- **Path traversal prevention** — all file operations sandboxed to the skills directory
- **ReDoS protection** — regex triggers validated against lookarounds, backreferences, and nested quantifiers
- **Dependency conflict detection** — uninstall blocks if other skills depend on the target

## Project Structure

```
SkillsMap/
├── packages/
│   ├── core/                  # CLI & SDK (the only published package)
│   │   ├── src/
│   │   │   ├── router.ts      # 4-stage routing engine
│   │   │   ├── installer.ts   # Git/local skill installer
│   │   │   ├── registry.ts    # Registry + BM25 index builder
│   │   │   ├── config.ts      # Dual-layer config loader
│   │   │   ├── validation.ts  # Schema + DAG + regex validation
│   │   │   ├── server.ts      # Dashboard HTTP server
│   │   │   └── cli.ts         # Commander-based CLI
│   │   └── tests/             # 94 tests (unit + E2E)
│   └── dashboard/             # Telemetry cockpit (Vite + React + SVG)
├── .github/workflows/ci.yml   # CI on Node 18 & 20
└── eslint.config.js
```

## License

[MIT](LICENSE)
