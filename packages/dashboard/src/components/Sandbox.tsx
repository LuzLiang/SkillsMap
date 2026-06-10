import React, { useState } from 'react';
import type { SkillNode, RouteResult } from '@skillsmap/core';

interface SandboxProps {
  skills: SkillNode[];
  source: 'local' | 'demo';
  onRouteSuccess: (result: RouteResult | null) => void;
}

export const Sandbox: React.FC<SandboxProps> = ({
  skills,
  source,
  onRouteSuccess
}) => {
  const [prompt, setPrompt] = useState('write a python script to parse logs and send alerts');
  const [top, setTop] = useState(1);
  const [verbose, setVerbose] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRoute = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const url = new URL('/api/route', window.location.origin);
      url.searchParams.set('prompt', prompt);
      url.searchParams.set('top', String(top));
      url.searchParams.set('verbose', String(verbose));
      url.searchParams.set('source', source);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const res = await response.json() as RouteResult;
      setResult(res);
      onRouteSuccess(res);
    } catch (err) {
      console.error('Error during routing:', err);
    } finally {
      setLoading(false);
    }
  };

  // Find matched skill node for priority lookup
  const matchedNode = result?.match ? skills.find(s => s.id === result.match?.id) : null;
  const matchedPriority = matchedNode?.priority ?? 0;

  // Calculate scores breakdown
  const regexScore = result?.metrics?.regexScore ?? 0;
  const tagScore = result?.metrics?.tagScore ?? 0;
  const bm25Score = result?.metrics?.bm25Score ?? 0;
  const priorityScore = matchedPriority;

  const rawScore = (1.0 * regexScore) + (0.4 * tagScore) + (0.5 * bm25Score) + (0.05 * priorityScore);
  const clampedScore = Math.min(1.0, Math.max(0.0, rawScore));

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4">
      <div>
        <h3 className="font-semibold text-slate-800 flex items-center gap-1.5 mb-1">
          <span>🎮</span> SDK Router Sandbox
        </h3>
        <p className="text-xs text-slate-500">
          Enter a prompt and check how the routing engine evaluates your skill dependency pathways.
        </p>
      </div>

      {/* Prompt Input */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-slate-600 font-mono">Routing Prompt</label>
        <textarea
          className="w-full text-sm font-sans p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
          placeholder="e.g. build a postgres database schema and run tests..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      {/* Parameters */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-slate-600 block mb-1">Top Matches (k)</label>
          <input
            type="number"
            className="w-full text-sm p-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            min={1}
            max={5}
            value={top}
            onChange={(e) => setTop(parseInt(e.target.value) || 1)}
          />
        </div>
        <div className="flex items-end pb-2.5">
          <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-slate-600">
            <input
              type="checkbox"
              className="rounded text-blue-600 border-slate-200 focus:ring-blue-500 w-4 h-4"
              checked={verbose}
              onChange={(e) => setVerbose(e.target.checked)}
            />
            Verbose Logging
          </label>
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={handleRoute}
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm disabled:bg-blue-400"
      >
        {loading ? 'Routing...' : 'Route Prompt 🚀'}
      </button>

      {/* Result Output */}
      {result && (
        <div className="mt-2 border-t border-slate-100 pt-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase font-mono">Routing Status</span>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                result.status === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
            >
              {result.status}
            </span>
          </div>

          {result.status === 'success' && result.match && (
            <>
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs flex flex-col gap-1.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Best Match ID:</span>
                  <span className="font-semibold text-slate-800">{result.match.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Match Score:</span>
                  <span className="font-semibold text-blue-600">{result.match.score.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Execution Time:</span>
                  <span className="font-semibold text-slate-700">{result.metrics.executionTimeMs} ms</span>
                </div>
              </div>

              {/* Dependency Pathway */}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-500 font-mono">Dependency Pathway</span>
                <div className="text-xs bg-slate-50 border border-slate-100 rounded-lg p-3 font-mono text-slate-700 leading-relaxed overflow-x-auto whitespace-nowrap">
                  {result.pathway.length > 0 ? (
                    result.pathway.map((nodeId, idx) => (
                      <React.Fragment key={nodeId}>
                        <span className="bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm text-slate-800">
                          {nodeId}
                        </span>
                        {idx < result.pathway.length - 1 && <span className="mx-1.5 text-slate-400">→</span>}
                      </React.Fragment>
                    ))
                  ) : (
                    <span className="text-slate-400 italic">No dependencies</span>
                  )}
                </div>
              </div>

              {/* Score Breakdown Table */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-slate-500 font-mono">Score Breakdown</span>
                <table className="min-w-full text-xs font-mono border border-slate-200 rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                      <th className="p-2 font-semibold">Stage</th>
                      <th className="p-2 font-semibold">Metric</th>
                      <th className="p-2 font-semibold text-right">Value</th>
                      <th className="p-2 font-semibold text-right">Weighted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    <tr>
                      <td className="p-2 text-slate-500">Stage 1</td>
                      <td className="p-2 font-semibold">Regex Score</td>
                      <td className="p-2 text-right">{regexScore.toFixed(2)}</td>
                      <td className="p-2 text-right">{(regexScore * 1.0).toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="p-2 text-slate-500">Stage 2</td>
                      <td className="p-2 font-semibold">Tag Score</td>
                      <td className="p-2 text-right">{tagScore.toFixed(2)}</td>
                      <td className="p-2 text-right">{(tagScore * 0.4).toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td className="p-2 text-slate-500">Stage 3</td>
                      <td className="p-2 font-semibold">BM25 Score</td>
                      <td className="p-2 text-right">{bm25Score.toFixed(4)}</td>
                      <td className="p-2 text-right">{(bm25Score * 0.5).toFixed(4)}</td>
                    </tr>
                    <tr>
                      <td className="p-2 text-slate-500">Stage 4</td>
                      <td className="p-2 font-semibold">Priority Bias</td>
                      <td className="p-2 text-right">{priorityScore.toFixed(2)}</td>
                      <td className="p-2 text-right">{(priorityScore * 0.05).toFixed(4)}</td>
                    </tr>
                    <tr className="bg-blue-50/50 font-bold border-t border-slate-200 text-blue-900">
                      <td colSpan={2} className="p-2 text-left">Combined Score (Clamped)</td>
                      <td className="p-2 text-right">Raw: {rawScore.toFixed(4)}</td>
                      <td className="p-2 text-right text-blue-600">{clampedScore.toFixed(4)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Score Formula Visualizer */}
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 text-[10px] text-slate-500 font-mono leading-relaxed">
                <div className="font-semibold text-slate-600 mb-1">Score Formula:</div>
                <div className="bg-white border border-slate-200 p-1.5 rounded text-center text-slate-800 font-bold">
                  Score = min(1.0, max(0.0, 1.0*Regex + 0.4*Tag + 0.5*BM25 + 0.05*Priority))
                </div>
                <div className="mt-1">
                  Calculated: min(1.0, max(0.0, 1.0 * {regexScore} + 0.4 * {tagScore} + 0.5 * {bm25Score.toFixed(4)} + 0.05 * {priorityScore})) = <span className="text-blue-600 font-semibold">{clampedScore.toFixed(4)}</span>
                </div>
              </div>
            </>
          )}

          {result.status === 'no_match' && (
            <div className="bg-rose-50 border border-rose-100 text-rose-700 text-xs font-semibold rounded-lg p-3 font-mono text-center">
              ❌ No skill match met the activation threshold (Score &gt; 0).
            </div>
          )}
        </div>
      )}
    </div>
  );
};
