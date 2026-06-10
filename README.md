# SkillsMap 🚀

SkillsMap is an ultra-lightweight, high-performance, and secure skills package manager, registry, and routing engine for agentic AI applications. It helps you modularize agent capabilities (skills) into stand-alone packages, install them from local directories or remote Git repositories, and dynamically route user prompts to the most matching skill using a 4-stage hybrid routing pipeline (Regex, Keywords/Tags, BM25).

---

## 📦 Features

*   **Modular Skill Packages**: Define skill triggers, domains, and entrypoints inside a simple `skill.json` configuration file.
*   **Secure Installer**: Install remote Git repositories with whitelisting and path traversal guards, or register local folders using fast symlinks/junctions.
*   **Asynchronous & Event-Loop Safe**: Native non-blocking asynchronous file operations keep your core Node applications responsive.
*   **4-Stage Routing Pipeline**:
    *   *Stage 0*: Domain classification (using fast $O(1)$ Set lookups).
    *   *Stage 1*: Regular expression matching (guarded against ReDoS backtracking).
    *   *Stage 2*: Keyword filtering & sub-linear tag overlap normalization.
    *   *Stage 3*: Normalised BM25 ranking (backed by disk cached index or fallback on-the-fly computation).
*   **Telemetry Dashboard**: Zero-runtime-dependency dynamic HTTP telemetry server to inspect configurations and query routing paths interactively.

---

## ⚙️ Installation

Install the CLI globally or add the SDK to your project:

```bash
# Programmatic SDK & local CLI
npm install @skillsmap/core

# Or run directly via npx
npx skillsmap --help
```

---

## 🛠️ CLI Quick Reference

| Command | Arguments / Options | Description |
|:---|:---|:---|
| `install` | `<git-url>` | Clones and registers a remote skill from a Git URL |
| `register` | `<local-path>` | Registers a local skill directory using symlinks |
| `uninstall` | `<skill-id> [-f]` | Deregisters a skill (checks dependency conflicts unless `-f` is passed) |
| `list` | `[--format text\|json] [--domain <name>]` | Lists all registered skills |
| `validate` | `[-c <path>]` | Checks DAG cycle conflicts, entrypoint existence, and configuration integrity |
| `route` | `<prompt> [-c <path>] [--top N] [--verbose] [-n]` | Evaluates a prompt and routes it to the matching skill |
| `index` | `[-r] [-c <path>]` | Updates the BM25 index (incremental check; forces with `-r`) |
| `dashboard` | `[-p <port>] [-c <path>]` | Starts the local cockpit server and visual dashboard |

---

## 📜 Configuration Specification (`skillsmap.json`)

Define a workspace structure using a `skillsmap.json` configuration file:

```json
{
  "fallbackNodeId": "default-fallback",
  "domains": {
    "coding": ["code", "function", "refactor"],
    "database": ["sql", "query", "mysql"]
  },
  "skills": [
    {
      "id": "code-skill",
      "name": "Python Coder",
      "description": "Writes clean python scripts and executes code.",
      "path": "./src/index.js",
      "tags": ["python", "script"],
      "domain": "coding",
      "category": "dev",
      "priority": 0.2,
      "dependencies": [],
      "triggers": {
        "regex": ["^run python.*$"],
        "keywords": ["python", "script"],
        "keywordsMatch": "any"
      }
    }
  ]
}
```

*Enable auto-completion in VS Code by adding the `$schema` parameter:*
`"$schema": "node_modules/@skillsmap/core/skillsmap.schema.json"`

---

## 💻 Programmatic SDK Usage

### 1. Dynamic Routing

```typescript
import { Router } from '@skillsmap/core';

const skills = [
  {
    id: 'db-query',
    name: 'DB Querier',
    description: 'Execute sql tables query postgres',
    path: 'db.js',
    tags: ['sql', 'postgres'],
    domain: 'database'
  }
];

// Initialize Router
const router = new Router(skills, 'default-fallback');

// Evaluate prompt
const result = await router.route('Run a postgres SELECT query');
if (result.status === 'success') {
  console.log(`Matched Skill ID: ${result.match.id}`);
  console.log(`Total Score: ${result.match.score}`);
}
```

### 2. Package Installer

```typescript
import { Installer } from '@skillsmap/core';

// Target a custom store path (default is ~/.skillsmap)
const installer = new Installer('/path/to/store');

// Register a local skill directory
await installer.registerLocal('./packages/my-custom-skill');

// List installed skills
const list = await installer.list('json');
console.log(list);
```

---

## 🛡️ Security Boundaries

*   **RCE Protection**: Remote Git URLs are strictly whitelisting-validated before invoking system clone binaries.
*   **Path Traversal Prevention**: Local registration and uninstallation paths are validated to stay within workspace boundaries, preventing arbitrary filesystem overrides or directory deletions.
*   **ReDoS Protections**: Skill triggers are evaluated against lookarounds, backreferences, and excessive nested quantifiers to block regular expression backtracking vulnerability attacks.

---

## 📄 License

MIT
