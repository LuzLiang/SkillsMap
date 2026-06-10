import React, { useMemo } from 'react';
import { SkillNode } from '@skillsmap/core';

interface GraphViewProps {
  skills: SkillNode[];
  activeDomains: Set<string>;
  highlightedNodes: Set<string>; // pathway from router
  clickedPathway: Set<string>;    // pathway from clicked node
  selectedNode: SkillNode | null;
  onSelectNode: (node: SkillNode | null) => void;
}

// Domain color mapping
const DOMAIN_COLORS: Record<string, { bg: string; border: string; text: string; raw: string }> = {
  coding: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af', raw: '#3b82f6' },
  sysadmin: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b', raw: '#ef4444' },
  database: { bg: '#ecfdf5', border: '#10b981', text: '#065f46', raw: '#10b981' },
  testing: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e', raw: '#f59e0b' },
  documentation: { bg: '#faf5ff', border: '#8b5cf6', text: '#5b21b6', raw: '#8b5cf6' },
  communication: { bg: '#fdf2f8', border: '#ec4899', text: '#9d174d', raw: '#ec4899' },
  science: { bg: '#f0fdfa', border: '#14b8a6', text: '#0f766e', raw: '#14b8a6' },
  browser: { bg: '#ecfeff', border: '#06b6d4', text: '#155e75', raw: '#06b6d4' },
  vcs: { bg: '#eef2ff', border: '#6366f1', text: '#3730a3', raw: '#6366f1' },
  cloud: { bg: '#f8fafc', border: '#64748b', text: '#334155', raw: '#64748b' },
  ai: { bg: '#fdf4ff', border: '#d946ef', text: '#86198f', raw: '#d946ef' },
  security: { bg: '#f7fee7', border: '#84cc16', text: '#3f6212', raw: '#84cc16' }
};

const DEFAULT_COLOR = { bg: '#f5f5f4', border: '#78716c', text: '#292524', raw: '#78716c' };

export const GraphView: React.FC<GraphViewProps> = ({
  skills,
  activeDomains,
  highlightedNodes,
  clickedPathway,
  selectedNode,
  onSelectNode
}) => {
  // 1. Calculate topological depth layers
  const layoutData = useMemo(() => {
    const memo = new Map<string, number>();
    const visited = new Set<string>();

    function getDepth(nodeId: string): number {
      if (memo.has(nodeId)) return memo.get(nodeId)!;
      if (visited.has(nodeId)) return 0; // break cycles

      visited.add(nodeId);
      const node = skills.find(s => s.id === nodeId);
      if (!node || !node.dependencies || node.dependencies.length === 0) {
        memo.set(nodeId, 0);
        visited.delete(nodeId);
        return 0;
      }

      let maxDepDepth = -1;
      for (const depId of node.dependencies) {
        if (skills.some(s => s.id === depId)) {
          maxDepDepth = Math.max(maxDepDepth, getDepth(depId));
        }
      }

      const depth = 1 + Math.max(0, maxDepDepth);
      memo.set(nodeId, depth);
      visited.delete(nodeId);
      return depth;
    }

    // Assign depth to all skills
    const nodeDepths: Record<string, number> = {};
    let maxDepth = 0;
    skills.forEach(node => {
      const d = getDepth(node.id);
      nodeDepths[node.id] = d;
      if (d > maxDepth) maxDepth = d;
    });

    // Group into layers
    const layers: SkillNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
    skills.forEach(node => {
      const d = nodeDepths[node.id];
      layers[d].push(node);
    });

    // Allocate coordinates
    const coords: Record<string, { x: number; y: number }> = {};
    const nodeWidth = 130;
    const nodeHeight = 36;

    layers.forEach((layer, layerIndex) => {
      const K = layer.length;
      layer.forEach((node, nodeIndex) => {
        const x = 80 + layerIndex * 180;
        // Distribute K nodes vertically in the 500px height space (offset 50px)
        const y = 50 + (nodeIndex + 1) * (500 / (K + 1));
        coords[node.id] = { x, y };
      });
    });

    return { coords, layers, nodeWidth, nodeHeight };
  }, [skills]);

  const { coords, nodeWidth, nodeHeight } = layoutData;

  // Render edges / links
  const edges = useMemo(() => {
    const list: Array<{
      id: string;
      sourceId: string;
      targetId: string;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      isHighlighted: boolean;
      isFaded: boolean;
    }> = [];

    skills.forEach(target => {
      if (!target.dependencies) return;
      target.dependencies.forEach(sourceId => {
        const source = skills.find(s => s.id === sourceId);
        if (!source) return;

        const pSource = coords[sourceId];
        const pTarget = coords[target.id];
        if (!pSource || !pTarget) return;

        // Links start at the right side of source node and end at the left side of target node
        const startX = pSource.x + nodeWidth / 2;
        const startY = pSource.y;
        const endX = pTarget.x - nodeWidth / 2;
        const endY = pTarget.y;

        // Highlight if both source and target are in highlighedNodes (routed pathway)
        // OR both are in clickedPathway (clicked node's pathway)
        const isHighlighted =
          (highlightedNodes.has(sourceId) && highlightedNodes.has(target.id)) ||
          (clickedPathway.has(sourceId) && clickedPathway.has(target.id));

        // Fade if either source or target domain is filtered out
        const isFaded =
          !activeDomains.has(source.domain || '') || !activeDomains.has(target.domain || '');

        list.push({
          id: `${sourceId}->${target.id}`,
          sourceId,
          targetId: target.id,
          startX,
          startY,
          endX,
          endY,
          isHighlighted,
          isFaded
        });
      });
    });

    return list;
  }, [skills, coords, highlightedNodes, clickedPathway, activeDomains, nodeWidth]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 relative select-none">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-slate-800 flex items-center gap-1.5">
          <span>📊</span> Skills Dependency Graph
        </h3>
        <div className="flex gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-blue-500 inline-block"></span> Routed Pathway
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-amber-500 inline-block"></span> Dependency Flow
          </span>
        </div>
      </div>

      <div className="overflow-auto border border-slate-100 rounded-lg bg-slate-50 flex justify-center">
        <svg
          width={800}
          height={600}
          viewBox="0 0 800 600"
          className="max-w-full h-auto"
        >
          <defs>
            {/* Arrow Marker for Default Edges */}
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#cbd5e1" />
            </marker>

            {/* Arrow Marker for Routed Highlighted Edges */}
            <marker
              id="arrow-route"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#3b82f6" />
            </marker>

            {/* Arrow Marker for Clicked Highlighted Edges */}
            <marker
              id="arrow-click"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f59e0b" />
            </marker>
          </defs>

          {/* 1. Draw Links/Edges */}
          {edges.map(edge => {
            const isRouteHighlight =
              highlightedNodes.has(edge.sourceId) && highlightedNodes.has(edge.targetId);
            const isClickHighlight =
              clickedPathway.has(edge.sourceId) && clickedPathway.has(edge.targetId);

            let strokeColor = '#cbd5e1';
            let strokeWidth = 1.5;
            let markerId = 'arrow';

            if (isRouteHighlight) {
              strokeColor = '#3b82f6';
              strokeWidth = 2.5;
              markerId = 'arrow-route';
            } else if (isClickHighlight) {
              strokeColor = '#f59e0b';
              strokeWidth = 2.5;
              markerId = 'arrow-click';
            }

            // Path calculation (horizontal S-curve)
            const controlOffset = 60;
            const pathD = `M ${edge.startX} ${edge.startY} C ${edge.startX + controlOffset} ${edge.startY}, ${edge.endX - controlOffset} ${edge.endY}, ${edge.endX} ${edge.endY}`;

            return (
              <path
                key={edge.id}
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                markerEnd={`url(#${markerId})`}
                opacity={edge.isFaded ? 0.15 : 1}
                className="transition-all duration-300"
              />
            );
          })}

          {/* 2. Draw Nodes */}
          {skills.map(node => {
            const p = coords[node.id];
            if (!p) return null;

            const domainColor = DOMAIN_COLORS[node.domain || ''] || DEFAULT_COLOR;
            const isRouteHighlighted = highlightedNodes.has(node.id);
            const isClickHighlighted = clickedPathway.has(node.id);
            const isFilteredOut = !activeDomains.has(node.domain || '');
            const isSelected = selectedNode?.id === node.id;

            // Highlight border and effect
            let borderColor = domainColor.border;
            let borderWidth = 1.5;

            if (isRouteHighlighted) {
              borderColor = '#3b82f6';
              borderWidth = 3;
            } else if (isClickHighlighted) {
              borderColor = '#f59e0b';
              borderWidth = 3;
            }

            return (
              <g
                key={node.id}
                transform={`translate(${p.x}, ${p.y})`}
                className="cursor-pointer select-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(node);
                }}
                opacity={isFilteredOut ? 0.2 : 1}
              >
                {/* Node Box */}
                <rect
                  x={-nodeWidth / 2}
                  y={-nodeHeight / 2}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx={6}
                  fill={domainColor.bg}
                  stroke={isSelected ? '#4f46e5' : borderColor}
                  strokeWidth={borderWidth}
                  className="transition-all duration-300"
                />

                {/* Node Text */}
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={domainColor.text}
                  fontSize={11}
                  fontWeight="600"
                  className="pointer-events-none font-mono"
                >
                  {node.id}
                </text>

                {/* Hover title/tooltip built-in */}
                <title>{`${node.name}\nDomain: ${node.domain || 'none'}\nTags: ${node.tags.join(', ')}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
