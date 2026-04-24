import os
import json
from typing import List, Dict
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("OPENAI_API_KEY")

if not api_key:
    print("⚠️  No OPENAI_API_KEY found → using rule-based reasoning only")
    client = None
else:
    from openai import OpenAI
    client = OpenAI(api_key=api_key)


# ─── Rule-based analysis ───────────────────────────────────────────────────────

def analyze_system(graph) -> List[str]:
    insights = []
    for node in graph["nodes"]:
        if node["type"] == "requirement":
            text = node["label"].lower()
            if "perform" in text:
                insights.append(f"Vague requirement (no metric): {node['label']}")
            if not any(k in text for k in ["at least", "within", "%", "minimum", "maximum", "below", "above"]):
                insights.append(f"Not measurable: {node['label']}")
    return insights


# ─── LLM reasoning ────────────────────────────────────────────────────────────

def llm_reasoning(graph, mission) -> List[Dict]:
    if client is None:
        return []

    prompt = f"""
You are a senior systems engineer with expertise in functional analysis and spacecraft design.

Mission:
{mission}

Graph:
{graph}

Identify missing functions or requirements and suggest improvements.

Return ONLY JSON:
{{
  "suggestions": [
    {{
      "type": "add_function" | "add_requirement",
      "target": "<node_id>",
      "content": "<new content>",
      "reason": "<why>"
    }}
  ]
}}
"""
    try:
        response = client.chat.completions.create(
            model="gpt-4o",          # was incorrectly "gpt-5.1"
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        parsed = json.loads(response.choices[0].message.content)
        return parsed.get("suggestions", [])
    except Exception:
        return []


# ─── Rule-based suggestions ───────────────────────────────────────────────────

def suggest_improvements(graph) -> List[Dict]:
    suggestions = []
    for node in graph["nodes"]:
        if node["type"] == "function":
            name = node["label"].lower()
            if "data" in name:
                suggestions.append({
                    "type":    "add_function",
                    "target":  node["id"],
                    "content": "Add data compression stage",
                    "reason":  "Reduce bandwidth usage",
                })
    return suggestions


# ─── Merge ────────────────────────────────────────────────────────────────────

def generate_ai_suggestions(graph, mission):
    return suggest_improvements(graph) + llm_reasoning(graph, mission)


# ─── Apply ────────────────────────────────────────────────────────────────────

def apply_suggestion(graph, suggestion):
    import uuid

    if suggestion["type"] == "add_function":
        new_id = f"func_{uuid.uuid4().hex[:6]}"
        graph["nodes"].append({"id": new_id, "type": "function", "label": suggestion["content"]})
        graph["edges"].append({"source": suggestion["target"], "target": new_id, "type": "decomposes"})

    if suggestion["type"] == "add_requirement":
        new_id = f"req_{uuid.uuid4().hex[:6]}"
        graph["nodes"].append({"id": new_id, "type": "requirement", "label": suggestion["content"]})
        graph["edges"].append({"source": suggestion["target"], "target": new_id, "type": "satisfies"})

    return graph