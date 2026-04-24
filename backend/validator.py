"""
validator.py — ECSS-E-10-05A compliant validation

Improvements applied (mapped to standard clauses):
  §3.1.2   — Function names must be declarative (verb + object noun)
  §4.5.3e  — No parent function may have more than 7 children
  §4.5.3i  — Interrelationships between sibling functions must be identified
  §4.7.6   — Both backwards AND forward traceability must be validated
  §4.5.1d  — Performance criteria required; scoring extended to constraints
  §4.8.1   — Critical functions flagged for FMECA attention
"""

import re
from collections import defaultdict
from typing import List, Dict, Any


# ─── §4.7.6 Forward + Backward traceability ───────────────────────────────────

def validate_graph(G) -> List[str]:
    """
    Validates the requirement traceability graph.
    ECSS §4.7.6: all functions must be both forward- AND backward-traceable.
    """
    errors = []

    for node, data in G.nodes(data=True):
        if data["type"] == "function":
            outgoing = list(G.out_edges(node, data=True))
            incoming = list(G.in_edges(node, data=True))
            is_root  = len(incoming) == 0

            # Forward traceability: every non-root function must satisfy ≥1 requirement
            has_req = any(e[2]["type"] == "satisfies" for e in outgoing)
            if not has_req and not is_root:
                errors.append(
                    f"[FORWARD TRACE] {node} has no requirement — "
                    f"ECSS §4.7.6c: every function shall be forward-traceable."
                )

            # Backward traceability: every non-root function must be reachable
            # from a parent (decomposed from a higher-level function)
            has_parent = any(e[2].get("type") == "decomposes" for e in incoming)
            if not has_parent and not is_root:
                errors.append(
                    f"[BACKWARD TRACE] {node} has no parent decomposition — "
                    f"ECSS §4.7.6b: subfunctions shall trace back to their mother function."
                )

    return errors


# ─── §4.5.3e  Max-7-subfunctions rule ─────────────────────────────────────────

def validate_decomposition_depth(functions) -> List[str]:
    """
    ECSS §4.5.3e: each function should not be decomposed into more than
    seven subfunctions at the next lower level.
    """
    errors = []
    children_count: Dict[str, int] = defaultdict(int)

    for f in functions:
        if f.parent_id is not None:
            children_count[f.parent_id] += 1

    for parent_id, count in children_count.items():
        if count > 7:
            errors.append(
                f"[DECOMP] Function {parent_id} has {count} children — "
                f"ECSS §4.5.3e: decompose into no more than 7 subfunctions."
            )
    return errors


# ─── §3.1.2  Declarative function naming ──────────────────────────────────────

# Common imperative verbs used in good function names (ECSS NOTE: "Validate Telecommands")
DECLARATIVE_VERBS = {
    "acquire", "process", "store", "transmit", "receive", "generate", "manage",
    "control", "monitor", "validate", "verify", "perform", "execute", "detect",
    "identify", "analyse", "analyze", "provide", "establish", "maintain",
    "calibrate", "compress", "format", "filter", "write", "protect", "downlink",
    "uplink", "navigate", "conduct", "survive", "communicate", "route", "amplify",
    "demodulate", "decode", "encode", "point", "orient", "stabilise", "stabilize",
    "mitigate", "handle", "sequence", "operate", "collect", "update", "relay",
    "switch", "forward", "report", "apply", "compute", "allocate", "schedule",
    "confirm", "ensure",
}

def validate_function_naming(functions) -> List[str]:
    """
    ECSS §3.1.2: function names shall have a declarative structure (verb + object)
    and say 'what' is done rather than 'how'.
    """
    errors = []
    for f in functions:
        if f.parent_id is None:
            continue  # Root/mission node exempt
        first_word = f.name.split()[0].lower().rstrip("s") if f.name else ""
        if first_word not in DECLARATIVE_VERBS:
            errors.append(
                f"[NAMING] '{f.name}' — ECSS §3.1.2: function name should start "
                f"with a declarative verb (e.g. 'Validate Telecommands')."
            )
    return errors


# ─── §4.8.1  Critical function identification (FMECA basis) ──────────────────

CRITICALITY_KEYWORDS = [
    "safe mode", "fault", "failure", "anomaly", "fdir", "redundan",
    "power", "thermal", "attitude", "navigation", "command", "telemetry",
    "health", "monitor", "isolat", "recover", "contingenc",
]

def identify_critical_functions(functions) -> List[Dict[str, str]]:
    """
    ECSS §4.8.1: functional analysis shall identify functions required for
    failure detection, isolation and recovery — flagged here as candidates
    for FMECA analysis.
    """
    critical = []
    for f in functions:
        name_lower = f.name.lower()
        if any(kw in name_lower for kw in CRITICALITY_KEYWORDS):
            critical.append({
                "id":     f.id,
                "name":   f.name,
                "reason": "Candidate for FMECA — involves fault tolerance, "
                          "safety, or mission-critical resource management "
                          "(ECSS §4.8.1).",
            })
    return critical


# ─── §4.5.1d  Requirement quality (performance criteria) ─────────────────────

def validate_requirements_quality(requirements) -> List[str]:
    errors = []
    for r in requirements:
        text = r.description.lower()
        if not any(k in text for k in ["at least", "within", "minimum", "maximum", "%"]):
            errors.append(f"{r.id} not measurable — ECSS §4.5.1d requires performance criteria.")
        if "perform" in text and not any(k in text for k in ["at least", "within", "%", "minimum", "maximum"]):
            errors.append(f"{r.id} too vague — quantify the performance threshold.")
    return errors


def score_requirement(text: str) -> int:
    score = 0
    if "shall" in text:                                                   score += 20
    if any(k in text for k in ["at least", "within", "maximum", "minimum"]): score += 30
    if any(u in text for u in ["%", "Hz", "Mbps", "kg", "W", "km", "ms", "dB", "krad", "bps"]): score += 30
    if len(text) > 20:                                                    score += 20
    return min(score, 100)


def enrich_requirements(requirements) -> List[Dict[str, Any]]:
    """Attach quality_score and quality_level; flag missing performance criteria (§4.5.1d)."""
    enriched = []
    for r in requirements:
        score = score_requirement(r.description)
        enriched.append({
            **r.dict(),
            "quality_score": score,
            "quality_level": (
                "high"   if score > 70 else
                "medium" if score > 40 else
                "low"
            ),
            "ecss_note": (
                None if score > 70 else
                "ECSS §4.5.1d: add quantitative performance criteria (threshold, unit, condition)."
            ),
        })
    return enriched


# ─── §4.6.3  Functional matrix generation ─────────────────────────────────────

def generate_functional_matrix(functions, requirements) -> Dict[str, Any]:
    """
    ECSS §4.6.3: produce a functional matrix showing which lower-level functions
    satisfy which requirements, and which parent they are decomposed from.

    Returns a dict suitable for JSON serialisation and display in the frontend.
    """
    # Build lookup tables
    req_map  = {r.related_function: r for r in requirements}
    children = defaultdict(list)
    id_to_fn = {}

    for f in functions:
        id_to_fn[f.id] = f
        if f.parent_id:
            children[f.parent_id].append(f)

    # Level-1 functions (direct children of root)
    root = next((f for f in functions if f.parent_id is None), None)
    if root is None:
        return {}

    level1 = children[root.id]
    all_reqs = list(requirements)

    rows = []
    for l1 in level1:
        # Level-2 children of this level-1 function
        for l2 in children[l1.id]:
            req = req_map.get(l2.id)
            rows.append({
                "level1_id":    l1.id,
                "level1_name":  l1.name,
                "level2_id":    l2.id,
                "level2_name":  l2.name,
                "requirement":  req.description if req else "—",
                "req_id":       req.id if req else None,
            })

    # Column headers = all level-1 function names
    columns = [f.name for f in level1]

    return {
        "columns": columns,
        "rows":    rows,
        "description": (
            "Functional matrix (ECSS §4.6.3): maps level-2 functions to their "
            "level-1 parent and the requirement each satisfies."
        ),
    }


# ─── §4.5.3i  Sibling interrelationship identification ───────────────────────

def identify_functional_interfaces(functions, graph_data) -> List[Dict[str, str]]:
    """
    ECSS §4.5.3i: functional analysis shall identify the interrelationships
    between functions.  We infer likely data/control interfaces between sibling
    functions by matching keyword pairs that commonly produce/consume the same
    resource.
    """
    INTERFACE_PAIRS = [
        ({"acquire", "capture", "collect"},           {"process", "compress", "format", "filter"},   "data"),
        ({"process", "compress", "format"},           {"store", "write"},                             "processed data"),
        ({"store", "write"},                          {"transmit", "downlink", "relay"},              "stored data"),
        ({"receive", "demodulate", "decode"},         {"route", "switch", "forward"},                 "decoded frames"),
        ({"monitor", "detect"},                       {"isolate", "recover", "safe mode", "handle"},  "fault signal"),
        ({"navigate", "determine position"},          {"execute", "perform trajectory", "perform mid-course"}, "nav state"),
        ({"manage electrical power", "eps", "power"}, {"*"},                                          "power bus"),
    ]

    interfaces = []
    fn_list = [f for f in functions if f.parent_id is not None]

    for i, f1 in enumerate(fn_list):
        for f2 in fn_list[i+1:]:
            n1, n2 = f1.name.lower(), f2.name.lower()
            for (producers, consumers, resource) in INTERFACE_PAIRS:
                prod_match = any(kw in n1 for kw in producers) or "*" in producers
                cons_match = any(kw in n2 for kw in consumers) or "*" in consumers
                if prod_match and cons_match:
                    interfaces.append({
                        "from":     f1.id,
                        "from_name":f1.name,
                        "to":       f2.id,
                        "to_name":  f2.name,
                        "resource": resource,
                        "note":     f"ECSS §4.5.3i: inferred functional interface via '{resource}'.",
                    })
                    break  # one interface per pair is sufficient
    return interfaces


# ─── §5.2  Phase-awareness annotation ────────────────────────────────────────

PHASE_FUNCTION_MAP = {
    "Phase 0": ["mission", "scenario", "user requirement", "concept"],
    "Phase A": ["feasibility", "operational concept", "preliminary"],
    "Phase B": ["architecture", "functional architecture", "trade", "detail"],
    "Phase C": ["detailed design", "procurement", "interface control", "validation"],
}

def annotate_phase_relevance(functions) -> List[Dict[str, str]]:
    """
    ECSS §5.2: functional analysis objectives differ per project phase.
    Annotate each function with the most relevant design phase.
    """
    annotated = []
    for f in functions:
        name_lower = f.name.lower()
        phase = "Phase B"  # default — most functions belong to detailed definition
        for ph, keywords in PHASE_FUNCTION_MAP.items():
            if any(kw in name_lower for kw in keywords):
                phase = ph
                break
        annotated.append({"id": f.id, "name": f.name, "phase": phase})
    return annotated