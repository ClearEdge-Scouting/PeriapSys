import networkx as nx
import uuid


def build_graph(functions, requirements, subsystems, traceability, mapping, interfaces):
    G = nx.DiGraph()

    root_function = next(f for f in functions if f.parent_id is None)
    root_id = root_function.id

    # ── Functions ─────────────────────────────────────────────────────────────
    for f in functions:
        node_type = "mission" if f.parent_id is None else "function"
        G.add_node(f.id, type=node_type, label=f.name)

        # Add decomposes edge for EVERY function that has a parent
        # (including direct children of root — previously missing)
        if f.parent_id is not None:
            G.add_edge(f.parent_id, f.id, id=str(uuid.uuid4()), type="decomposes")

    # ── Requirements ──────────────────────────────────────────────────────────
    for r in requirements:
        G.add_node(r.id, type="requirement", label=r.description)

    # ── Subsystems ────────────────────────────────────────────────────────────
    for s in subsystems:
        G.add_node(s.id, type="subsystem", label=s.name)
        # Connect each subsystem to the mission root
        if not G.has_edge(root_id, s.id):
            G.add_edge(root_id, s.id, id=str(uuid.uuid4()), type="decomposes")

    # ── Traceability: function → requirement (satisfies) ──────────────────────
    for t in traceability:
        G.add_edge(t.function_id, t.requirement_id, id=str(uuid.uuid4()), type="satisfies")

    # ── Allocation: subsystem → function (implements) ─────────────────────────
    for func_id, sub_name in mapping.items():
        for s in subsystems:
            if s.name == sub_name:
                if not G.has_edge(s.id, func_id):
                    G.add_edge(s.id, func_id, id=str(uuid.uuid4()), type="implements")

    # ── Interfaces ────────────────────────────────────────────────────────────
    for i in interfaces:
        G.add_node(i["id"], type="interface", label=i["type"])

        G.add_edge(i["source"], i["id"],
                id=str(uuid.uuid4()), type="outputs")

        G.add_edge(i["id"], i["target"],
                id=str(uuid.uuid4()), type="inputs")
        
    return G