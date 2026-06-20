import { useState, useMemo, useEffect } from 'react';
import type { SkillNode, RouteResult } from '@skillsmap/core';
import { GraphView } from './components/GraphView';
import { Sandbox } from './components/Sandbox';

// Default Demo Skills DAG
const DEMO_SKILLS: SkillNode[] = [
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
  },
  {
    id: 'tweetclaw-x-twitter',
    name: 'TweetClaw X/Twitter Automation',
    description: 'Routes X/Twitter automation requests for scraping tweets, searching tweet replies, posting tweets, follower export, media upload, webhooks, and API workflows',
    path: 'index.js',
    tags: ['twitter', 'x', 'tweet', 'tweets', 'tweet-scraper', 'replies', 'followers', 'media', 'webhooks', 'automation', 'api'],
    domain: 'communication',
    category: 'social-media',
    priority: 0.35,
    triggers: {
      regex: [
        '\\b(search|scrape|post|monitor)\\b.*\\b(tweet|tweets|twitter)\\b',
        '\\b(tweet|tweets|twitter)\\b.*\\b(replies|reply|followers|media|webhooks|direct messages|direct message)\\b'
      ]
    }
  }
];

function App() {
  const [skillsSource, setSkillsSource] = useState<'local' | 'demo'>('local');
  const [currentConfig, setCurrentConfig] = useState<{
    skills: SkillNode[];
    fallbackNodeId?: string;
    domains?: Record<string, string[]>;
  }>({
    skills: [],
    fallbackNodeId: undefined,
    domains: undefined
  });
  const [loading, setLoading] = useState(true);

  // Fetch config dynamically whenever skillsSource changes
  useEffect(() => {
    setLoading(true);
    fetch(`/api/config?source=${skillsSource}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch config');
        return res.json();
      })
      .then(data => {
        const normalized: { skills: SkillNode[]; fallbackNodeId?: string; domains?: Record<string, string[]> } = {
          skills: [],
          fallbackNodeId: undefined,
          domains: undefined
        };
        if (Array.isArray(data)) {
          normalized.skills = data;
        } else if (data) {
          normalized.skills = data.skills || [];
          normalized.fallbackNodeId = data.fallbackNodeId;
          normalized.domains = data.domains;
        }
        setCurrentConfig(normalized);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching config from server:', err);
        // Fallback to local demo skills if API is unreachable
        if (skillsSource === 'demo') {
          setCurrentConfig({
            skills: DEMO_SKILLS,
            fallbackNodeId: 'git-init',
            domains: undefined
          });
        } else {
          setCurrentConfig({
            skills: [],
            fallbackNodeId: undefined,
            domains: undefined
          });
        }
        setLoading(false);
      });
  }, [skillsSource]);

  const currentSkills = currentConfig.skills;

  // Domain Filter States
  const uniqueDomains = useMemo(() => {
    const domains = new Set<string>();
    currentSkills.forEach((s: SkillNode) => {
      if (s.domain) {
        domains.add(s.domain);
      }
    });
    return Array.from(domains).sort();
  }, [currentSkills]);

  const [activeDomains, setActiveDomains] = useState<Set<string>>(new Set());

  // Whenever skills or unique domains change, reset filters to active/checked
  useEffect(() => {
    setActiveDomains(new Set(uniqueDomains));
  }, [uniqueDomains]);

  // Route result highlighting state
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());

  // Clicked node dependency highlighting state
  const [selectedNode, setSelectedNode] = useState<SkillNode | null>(null);
  const [clickedPathway, setClickedPathway] = useState<Set<string>>(new Set());

  const handleRouteSuccess = (res: RouteResult | null) => {
    if (res && res.status === 'success' && res.match) {
      setHighlightedNodes(new Set(res.pathway));
    } else {
      setHighlightedNodes(new Set());
    }
  };

  // Compute pathway recursively for a clicked/selected node
  const handleSelectNode = (node: SkillNode | null) => {
    setSelectedNode(node);
    if (!node) {
      setClickedPathway(new Set());
      return;
    }

    const path = new Set<string>();
    const visit = (id: string) => {
      if (path.has(id)) return;
      path.add(id);
      const sNode = currentSkills.find((s: SkillNode) => s.id === id);
      if (sNode && sNode.dependencies) {
        sNode.dependencies.forEach((depId: string) => visit(depId));
      }
    };
    visit(node.id);
    setClickedPathway(path);
  };

  const handleToggleDomain = (domain: string) => {
    const next = new Set(activeDomains);
    if (next.has(domain)) {
      next.delete(domain);
    } else {
      next.add(domain);
    }
    setActiveDomains(next);
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }} className="min-h-screen bg-slate-50 text-slate-900 pb-12">
      {/* Header bar */}
      <header className="bg-slate-900 text-white py-4 px-8 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🛸</span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">SkillsMap Cockpit Telemetry</h1>
            <p className="text-xs text-slate-400">
              Interactive DAG Visualization &amp; Sandbox Router{' '}
              {loading && <span className="text-blue-400 animate-pulse">(syncing API...)</span>}
            </p>
          </div>
        </div>

        {/* Source Toggle */}
        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
          <button
            onClick={() => {
              setSkillsSource('local');
              setHighlightedNodes(new Set());
              setSelectedNode(null);
              setClickedPathway(new Set());
            }}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              skillsSource === 'local'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Local Config
          </button>
          <button
            onClick={() => {
              setSkillsSource('demo');
              setHighlightedNodes(new Set());
              setSelectedNode(null);
              setClickedPathway(new Set());
            }}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              skillsSource === 'demo'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Demo Map ({DEMO_SKILLS.length})
          </button>
        </div>
      </header>

      {/* Main content grid */}
      <main className="max-w-[1440px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column - Sandbox Console, Details (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <Sandbox
            skills={currentSkills}
            source={skillsSource}
            onRouteSuccess={handleRouteSuccess}
          />

          {/* Node Details Panel */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3">
            <h3 className="font-semibold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <span>🔍</span> Selected Node Details
            </h3>
            {selectedNode ? (
              <div className="text-xs flex flex-col gap-3 font-mono">
                <div className="grid grid-cols-3 border-b border-slate-50 pb-1.5">
                  <span className="text-slate-500 font-semibold">ID:</span>
                  <span className="col-span-2 text-slate-800 font-bold">{selectedNode.id}</span>
                </div>
                <div className="grid grid-cols-3 border-b border-slate-50 pb-1.5">
                  <span className="text-slate-500 font-semibold">Name:</span>
                  <span className="col-span-2 text-slate-800">{selectedNode.name}</span>
                </div>
                <div className="grid grid-cols-3 border-b border-slate-50 pb-1.5">
                  <span className="text-slate-500 font-semibold">Domain:</span>
                  <span className="col-span-2">
                    <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold uppercase text-[10px]">
                      {selectedNode.domain || 'none'}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-3 border-b border-slate-50 pb-1.5">
                  <span className="text-slate-500 font-semibold">Category:</span>
                  <span className="col-span-2 text-slate-700">{selectedNode.category}</span>
                </div>
                <div className="grid grid-cols-3 border-b border-slate-50 pb-1.5">
                  <span className="text-slate-500 font-semibold">Priority Bias:</span>
                  <span className="col-span-2 text-slate-700">{selectedNode.priority ?? 0}</span>
                </div>
                <div className="flex flex-col gap-1 border-b border-slate-50 pb-1.5">
                  <span className="text-slate-500 font-semibold">Description:</span>
                  <span className="text-slate-700 font-sans leading-relaxed">{selectedNode.description}</span>
                </div>
                <div className="flex flex-col gap-1 border-b border-slate-50 pb-1.5">
                  <span className="text-slate-500 font-semibold">Tags:</span>
                  <div className="flex flex-wrap gap-1.5 mt-1 font-sans">
                    {selectedNode.tags.map(t => (
                      <span key={t} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[10px] border border-blue-100 font-mono">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500 font-semibold">Dependencies:</span>
                  <div className="flex flex-wrap gap-1.5 mt-1 font-sans">
                    {selectedNode.dependencies && selectedNode.dependencies.length > 0 ? (
                      selectedNode.dependencies.map(dep => (
                        <span key={dep} className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded text-[10px] border border-amber-100 font-mono font-semibold">
                          {dep}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400 italic font-mono text-[10px]">none</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic text-center py-6">
                Click a node on the dependency graph to view its triggers, metadata, and pathway stack.
              </p>
            )}
          </div>
        </div>

        {/* Right Column - SVG Graph and Domain Checklist (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Domain checklist filters */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 font-mono">
              Domain Visibility Filters
            </h4>
            <div className="flex flex-wrap gap-3">
              {uniqueDomains.length > 0 ? (
                uniqueDomains.map(domain => (
                  <label
                    key={domain}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer bg-slate-50 hover:bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="rounded text-blue-600 border-slate-300 focus:ring-blue-500 w-3.5 h-3.5"
                      checked={activeDomains.has(domain)}
                      onChange={() => handleToggleDomain(domain)}
                    />
                    <span className="capitalize">{domain}</span>
                  </label>
                ))
              ) : (
                <span className="text-xs text-slate-400 italic">No domains found in this map.</span>
              )}
            </div>
          </div>

          <GraphView
            skills={currentSkills}
            activeDomains={activeDomains}
            highlightedNodes={highlightedNodes}
            clickedPathway={clickedPathway}
            selectedNode={selectedNode}
            onSelectNode={handleSelectNode}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
