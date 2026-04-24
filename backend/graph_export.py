def export_graph(G):
    nodes = []
    edges = []

    for n, data in G.nodes(data=True):
        nodes.append({
            "id": n,
            "type": data["type"],
            "label": data["label"]
        })

    for s, t, data in G.edges(data=True):
        edges.append({
            "id": data.get("id"),
            "source": s,
            "target": t,
            "type": data["type"]
        })

    return {"nodes": nodes, "edges": edges}