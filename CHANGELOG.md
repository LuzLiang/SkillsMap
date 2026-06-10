# Changelog

All notable changes to the SkillsMap project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-06-09

This is the initial production-ready release of the SkillsMap core engine and telemetry cockpit dashboard.

### Added
- **Asynchronous Execution Model**: 
  - Migrated the entire routing, installation, and registration paths from synchronous filesystem functions to non-blocking asynchronous `fs.promises` operations.
  - Re-engineered `Installer` (`registerLocal`, `installFromGit`, `uninstall`, `list`), `RegistryManager` (`load`, `save`, `rebuildSkillsMap`), and config loader (`loadConfig`) to execute natively asynchronously.
  - Added `@deprecated` JSDoc annotations to the synchronous `ensureStoreInitialized` helper inside `src/utils.ts`.
- **4-Stage Hybrid Routing Pipeline**:
  - *Stage 0 (Domain Classification)*: Filters candidate skill nodes using fast $O(1)$ keyword-to-domain Set checks.
  - *Stage 1 (Regex Matcher)*: Scans literal regex triggers. Includes safeguards to reject complex expressions (lookarounds, backreferences, nested quantifiers) to prevent ReDoS CPU exhaustion.
  - *Stage 2 (Keyword & Tag Overlap)*: Evaluates direct matching triggers and normalizes dense skill overlap bias.
  - *Stage 3 (BM25 Document Ranking)*: Leverages term frequency saturation, inverse document frequency (IDF), and document length normalization for ranking. Implemented incremental cache validation that skips BM25 index builds unless modified or `--rebuild` is flag-forced.
- **Rich CLI Subcommands**:
  - `skillsmap install <git-url>`: Securely clones remote Git or local file repositories.
  - `skillsmap register <local-path>`: Integrates local development directories using symlinks/junctions.
  - `skillsmap uninstall <skill-id> [-f]`: Safely deregisters skills and validates graph dependency conflicts.
  - `skillsmap list [--format <text|json>] [--domain <name>]`: Lists registered skills in clean tabular stdout or structured JSON.
  - `skillsmap validate [-c <path>]`: Validates schema types, checks for DAG cycles, and verifies entrypoint file existence.
  - `skillsmap route <prompt> [-c <path>] [--top <N>] [--verbose]`: Evaluates and routes a prompt with detailed debug metrics printed to `process.stderr`.
  - `skillsmap index [-r] [-c <path>]`: Incremental builder or rebuilds BM25 index on demand.
  - `skillsmap init [-c <path>]`: Generates a template configuration file referencing the JSON Schema.
  - `skillsmap dashboard [-p <port>] [-c <path>]`: Starts the telemetry HTTP server.
- **Cockpit Telemetry Dashboard**:
  - Server-driven telemetry HTTP backend serving pre-compiled static assets.
  - Decoupled from legacy browser-only mocks, using live REST endpoints `/api/config` and `/api/route`.
  - Configured clean `process.on('SIGINT')` signal listener for graceful socket shutdown and process exit.
- **Developer Experience**:
  - Published workspace-wide flat configuration `eslint.config.js` targeting all TS/JS files.
  - Defined strict TypeScript type checking (`strict: true`) across packages.
  - Published configuration file `skillsmap.schema.json` mapping parameters to enable IDE IntelliSense.
  - Created automated vitest benchmark `router.bench.ts` to assert that 100-node routing latency stays under 1ms.
  - Configured `.github/workflows/ci.yml` running linting, build verification, tests, and benchmark latency checks on Node 18 & 20.

### Fixed
- **BM25 Division-by-Zero NaN Errors**: Guarded calculations against zero-length average document length (`avgdl`) and empty description collections (`maxBM25 === 0`) to prevent scores from resolving to `NaN`.
- **Empty Prompts**: Short-circuited empty queries or stopword-only strings at routing entry to directly return a no-match response.
- **Symlink Path Traversal Vulnerabilities**: Hardened installation and uninstallation directories using starts-with check verification bounds, preventing sandbox escapes or host folder deletions.
- **Git RCE Protections**: Enforced strict whitelisting for remote Git URLs prior to executing child clones.
- **Vitest Listener Leaks**: Cleared SIGINT listeners when closing dashboard servers to prevent test memory leak warnings.
