import React from "react";
import dagre from "dagre";

const nodeWidth = 200;
const nodeHeight = 80;

export function convertToFlow(graph) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // Top → Bottom layout
  dagreGraph.setGraph({
    rankdir: "TB",
    ranksep: 120,   // vertical spacing between layers
    nodesep: 80     // horizontal spacing
  });

  // --- Add nodes to dagre ---
  graph.nodes.forEach((node) => {
    const isRoot = node.type === "mission";

    dagreGraph.setNode(node.id, {
        width: nodeWidth,
        height: nodeHeight,
        ...(isRoot && { rank: 0 }) // only root gets top rank
    });
  });

  // --- Add edges ---
  graph.edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // --- Compute layout ---
  dagre.layout(dagreGraph);

  // --- Build React Flow nodes ---
  const nodes = graph.nodes.map((node) => {
    const dagreNode = dagreGraph.node(node.id);

    return {
      id: node.id,
      data: {
        label:
            node.type === "mission"
            ? node.label
            : React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 4 } },
                React.createElement(
                    "div",
                    { style: { fontSize: 10, opacity: 0.8 } },
                    node.type.toUpperCase()
                ),
                React.createElement("div", {
                    style: {
                    height: 1,
                    background: "white",
                    width: "100%"
                    }
                }),
                React.createElement("div", null, node.label)
                )
      },
      position: {
        x: dagreNode.x - nodeWidth / 2,
        y: dagreNode.y - nodeHeight / 2
      },
      style: {
        ...getNodeStyle(node.type),
        whiteSpace: "pre-line"
    },
      sourcePosition: "bottom",
      targetPosition: "top"
    };
  });

  // --- Build edges ---
  const edges = graph.edges.map((edge, i) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.type,
    animated: edge.type === "satisfies",
    style: getEdgeStyle(edge.type),
    selectable: true
  }));

  return { nodes, edges };
}


// ---------------- STYLING ---------------- //

function getNodeStyle(type) {
  if (type === "function") {
    return {
      background: "#1f77b4",
      color: "white",
      borderRadius: "8px",
      padding: 10
    };
  }

  if (type === "requirement") {
    return {
      background: "#2ca02c",
      color: "white",
      borderRadius: "8px",
      padding: 10
    };
  }

  if (type === "subsystem") {
    return {
      background: "#ff7f0e",
      color: "white",
      borderRadius: "8px",
      padding: 10
    };
  }
}

function getEdgeStyle(type) {
  if (type === "decomposes") {
    return { stroke: "#555" };
  }

  if (type === "satisfies") {
    return { stroke: "#2ca02c", strokeDasharray: "5,5" };
  }

  if (type === "implements") {
    return { stroke: "#ff7f0e" };
  }
}

// ---------------- GRAPH TRAVERSAL ---------------- //

export function getUpstream(graph, nodeId) {
  const visited = new Set();

  function dfs(id) {
    graph.edges.forEach((e) => {
      if (e.target === id && !visited.has(e.source)) {
        visited.add(e.source);
        dfs(e.source);
      }
    });
  }

  dfs(nodeId);
  return visited;
}

export function getDownstream(graph, nodeId) {
  const visited = new Set();

  function dfs(id) {
    graph.edges.forEach((e) => {
      if (e.source === id && !visited.has(e.target)) {
        visited.add(e.target);
        dfs(e.target);
      }
    });
  }

  dfs(nodeId);
  return visited;
}