const test = require('node:test');
const assert = require('node:assert');
const { Router, SkillsMap, RegistryManager, Installer } = require('../dist/index.js');

test('SkillsMap functionality', (t) => {
  const map = new SkillsMap();
  const node = {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A skill for testing',
    path: '/path/to/skill',
    tags: ['test', 'demo'],
    domain: 'testing',
    category: 'unit-test'
  };
  map.addNode(node);
  assert.deepEqual(map.getNode('test-skill'), node);
  assert.deepEqual(map.getAllNodes(), [node]);
});

test('Router functionality', (t) => {
  const node = {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A skill for testing',
    path: '/path/to/skill',
    tags: ['test', 'demo'],
    domain: 'testing',
    category: 'unit-test'
  };
  const router = new Router([node]);
  
  const resultSuccess = router.route('Give me a test');
  assert.equal(resultSuccess.status, 'success');
  assert.equal(resultSuccess.match?.id, 'test-skill');
  
  const resultFail = router.route('Something completely different');
  assert.equal(resultFail.status, 'no_match');
});

test('RegistryManager functionality', (t) => {
  const registry = new RegistryManager();
  registry.registerSkill('test-skill', 'local', '/path/to/skill');
  const skills = registry.getSkills();
  assert.ok(skills['test-skill']);
  assert.equal(skills['test-skill'].source, 'local');
  assert.equal(skills['test-skill'].localPath, '/path/to/skill');
});

test('Installer functionality', (t) => {
  const installer = new Installer('/install/dir');
  assert.equal(installer.getTargetDir(), '/install/dir');
  assert.ok(installer.install('test-skill'));
});
