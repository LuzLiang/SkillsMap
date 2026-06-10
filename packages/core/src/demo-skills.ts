import { SkillNode } from './types';

export const DEMO_SKILLS: SkillNode[] = [
  {
    id: 'git-init',
    name: 'Git Init',
    description: 'Initializes a new Git repository and sets up version control tracking',
    path: 'index.js',
    tags: ['git', 'version', 'init', 'vcs'],
    domain: 'vcs',
    category: 'version-control',
    priority: 0.2
  },
  {
    id: 'create-db',
    name: 'Create Database Table',
    description: 'Creates a relational database table schema, mysql, postgres, or sqlite',
    path: 'index.js',
    tags: ['sql', 'database', 'postgres', 'mysql', 'table'],
    domain: 'database',
    category: 'data-storage',
    priority: 0.1
  },
  {
    id: 'write-code',
    name: 'Write TypeScript Code',
    description: 'Writes typescript code, classes, functions and logic',
    path: 'index.js',
    tags: ['typescript', 'javascript', 'code', 'function'],
    domain: 'coding',
    category: 'programming',
    dependencies: ['git-init'],
    priority: 0.0
  },
  {
    id: 'run-tests',
    name: 'Run Unit Tests',
    description: 'Runs vitest unit tests and checks statement and branch coverage',
    path: 'index.js',
    tags: ['test', 'vitest', 'coverage', 'verify'],
    domain: 'testing',
    category: 'qa',
    dependencies: ['write-code'],
    priority: 0.0
  },
  {
    id: 'dockerize',
    name: 'Dockerize Application',
    description: 'Builds docker images and container configurations for deploying applications',
    path: 'index.js',
    tags: ['docker', 'container', 'deployment', 'kubernetes'],
    domain: 'cloud',
    category: 'ops',
    dependencies: ['write-code', 'create-db'],
    priority: 0.3
  },
  {
    id: 'deploy-aws',
    name: 'Deploy to AWS',
    description: 'Deploys containerized application to AWS ECS, GCP, or Azure cloud pipeline',
    path: 'index.js',
    tags: ['aws', 'cloud', 'deployment', 'pipeline'],
    domain: 'cloud',
    category: 'ops',
    dependencies: ['dockerize'],
    priority: 0.5
  },
  {
    id: 'write-docs',
    name: 'Write Project Documentation',
    description: 'Writes markdown files, project readmes, wikis and API documents',
    path: 'index.js',
    tags: ['markdown', 'readme', 'documentation', 'wiki'],
    domain: 'documentation',
    category: 'docs',
    dependencies: ['write-code'],
    priority: 0.0
  },
  {
    id: 'prompt-llm',
    name: 'Prompt LLM Agent',
    description: 'Invokes Claude, Gemini, or OpenAI LLM agents with system instructions and prompts',
    path: 'index.js',
    tags: ['prompt', 'llm', 'gemini', 'openai', 'agent'],
    domain: 'ai',
    category: 'artificial-intelligence',
    priority: 0.4
  }
];
