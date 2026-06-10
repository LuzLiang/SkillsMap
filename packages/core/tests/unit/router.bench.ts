import { bench, describe } from 'vitest';
import { Router } from '../../src/router';
import { SkillNode } from '../../src/types';

describe('Router Routing Performance (100 Nodes)', () => {
  // Generate 100 nodes for comprehensive benchmark testing
  const skills: SkillNode[] = Array.from({ length: 100 }, (_, i) => ({
    id: `skill-${i}`,
    name: `Skill Name ${i}`,
    description: `This is the description for skill ${i}. It covers topics like python coding, sql queries, database tables, unit tests, and documentation.`,
    path: `path/to/skill-${i}/index.js`,
    tags: [`tag-${i}`, `shared-tag-${i % 10}`],
    domain: i % 2 === 0 ? 'coding' : 'database',
    category: 'benchmark',
    priority: i % 10 === 0 ? 0.2 : 0,
    triggers: {
      regex: [`^run-command-${i}$`],
      keywords: [`keyword-${i}`, `common-key-${i % 5}`]
    }
  }));

  const router = new Router(skills, 'skill-0');

  bench('stage-based routing process latency', async () => {
    await router.route('Run coding python script and query sql database tables');
  });
});
