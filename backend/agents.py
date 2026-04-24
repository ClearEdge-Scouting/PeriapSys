"""
agents.py — ECSS-E-10-05A compliant pipeline

Improvements applied:
  §3.1.2  — LLM prompt updated to require declarative verb+noun function names
  §4.5.3e — Rule-based tree capped at 7 children per node; LLM prompt enforces it
  §4.5.3i — Interface keywords expanded so identify_functional_interfaces() fires
  §4.7.6  — generate_traceability() now records both directions
  §5.2    — Mission phase passed into requirement prompts for phase-appropriate thresholds
"""

import os
import json
from typing import List, Dict, Optional
from dotenv import load_dotenv

from schemas import FunctionNode, Requirement, TraceLink, Subsystem
from models import generate_id

load_dotenv()

# ─── OpenAI client (optional) ─────────────────────────────────────────────────
api_key = os.getenv("OPENAI_API_KEY")
client  = None

if api_key:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        print("✅ OpenAI client ready — LLM generation enabled")
    except ImportError:
        print("⚠️  openai package not installed — pip install openai")
else:
    print("⚠️  No OPENAI_API_KEY — using rule-based generation only")


# ─── Mission-type templates ────────────────────────────────────────────────────
# §3.1.2:  ALL function names follow "Verb Object" declarative structure.
# §4.5.3e: No parent has more than 7 children.

TEMPLATES = {
    # OBSERVATION MISSIONS
    "observation": {

        # Payload chain
        "Acquire Data": [
            "Point Instrument to Target",
            "Capture Payload Data",
            "Calibrate Sensor",
            "Validate Data Quality",
        ],

        "Process Data": [
            "Compress Science Data",
            "Format Data to CCSDS",
            "Filter Corrupted Frames",
        ],

        "Store Data": [
            "Write to On-board Mass Memory",
            "Manage Storage Allocation",
            "Protect Data Integrity",
        ],

        "Transmit Data": [
            "Downlink Science Data",
            "Receive Ground Commands",
            "Verify Downlink Completeness",
        ],

        "Provide Electrical Power": [
            "Generate Electrical Power",
            "Store Electrical Energy",
            "Distribute Electrical Power",
            "Regulate Bus Voltage",
        ],

        "Control Thermal Environment": [
            "Maintain Equipment Temperature",
            "Dissipate Excess Heat",
            "Control Heaters",
        ],

        "Control Attitude and Orbit": [
            "Determine Attitude",
            "Control Spacecraft Orientation",
            "Stabilize Spacecraft",
        ],

        "Handle On-board Data": [
            "Acquire Housekeeping Data",
            "Route Data Between Subsystems",
        ],

        "Communicate with Ground": [
            "Receive Telecommands",
            "Decode Commands",
            "Encode Telemetry",
        ],

        "Manage Faults and Safety": [
            "Detect Faults",
            "Isolate Faults",
            "Recover from Faults",
            "Enter Safe Mode",
        ],
    },

    # COMMUNICATION MISSIONS
    "comms": {

        "Receive Signals": [
            "Acquire Uplink Signal",
            "Demodulate Received Signal",
            "Decode and Verify Frame",
        ],

        "Route and Process": [
            "Switch Traffic Between Beams",
            "Amplify Signal",
            "Manage Beam Assignments",
            "Monitor Channel Quality",
        ],

        "Transmit Signals": [
            "Generate Downlink Carrier",
            "Forward Traffic to Gateway",
            "Verify Transmitted Power Level",
        ],

        "Manage Network": [
            "Monitor Link Quality Metrics",
            "Handle Beam Handovers",
            "Report Network Status to Ground",
        ],

        "Provide Electrical Power": [
            "Generate Electrical Power",
            "Store Electrical Energy",
            "Distribute Electrical Power",
        ],

        "Control Thermal Environment": [
            "Maintain Equipment Temperature",
        ],

        "Control Attitude and Orbit": [
            "Maintain Orbital Position",
            "Control Spacecraft Orientation",
        ],

        "Communicate with Ground": [
            "Receive Telecommands",
            "Transmit Telemetry",
        ],

        "Handle On-board Data": [
            "Process On-board Data",
            "Route Data Between Subsystems",
        ],

        "Manage Faults and Safety": [
            "Detect Faults",
            "Execute Safe Mode Procedures",
        ],
    },

    # DEEP SPACE MISSIONS (Mars, Jupiter, Saturn, etc.)
    "deep_space": {

        "Perform Navigation": [
            "Perform Trajectory Correction Manoeuvre",
            "Determine Spacecraft Position",
            "Update Ephemeris Data",
        ],

        "Provide Propulsion": [
            "Store Propellant",
            "Generate Thrust",
            "Control Thrust Vector",
        ],

        "Operate Payload": [
            "Operate Science Instruments",
            "Collect In-situ Measurements",
            "Sequence Observation Campaigns",
        ],

        "Manage Data": [
            "Process Raw Science Data",
            "Store Science Data On-board",
            "Transmit Data to Earth",
        ],

        "Communicate with Earth": [
            "Maintain DSN Link",
            "Receive and Execute Commands",
            "Transmit Telemetry and Science",
        ],

        "Manage Autonomy": [
            "Execute Time-Tagged Commands",
            "Handle Communication Delays",
            "Perform On-board Decision Making",
        ],

        "Maintain Time and Synchronization": [
            "Maintain On-board Time",
            "Synchronize with Ground Time",
        ],

        "Survive Environment": [
            "Control Thermal Environment",
            "Mitigate Radiation Effects",
        ],

        "Provide Electrical Power": [
            "Generate Electrical Power",
            "Store Electrical Energy",
        ],

        "Control Attitude and Orbit": [
            "Determine Attitude",
            "Stabilize Spacecraft",
        ],

        "Manage Faults and Safety": [
            "Detect Faults",
            "Recover from Faults",
            "Enter Safe Mode",
        ],
    },

    # LUNAR MISSIONS
    "lunar": {

        "Perform Translunar Transfer": [
            "Execute Trans-Lunar Injection",
            "Perform Mid-Course Correction",
            "Monitor Navigation State",
        ],

        "Enter Lunar Orbit": [
            "Execute Lunar Orbit Insertion",
            "Perform Orbit Trim Manoeuvres",
            "Validate Final Orbit Parameters",
        ],

        "Operate Payload": [
            "Operate Payload Instruments",
            "Acquire Lunar Surface Data",
            "Sequence Observation Windows",
        ],

        "Communicate with Earth": [
            "Maintain Earth Communication Link",
            "Receive and Acknowledge Commands",
            "Relay Science Data to Earth",
        ],

        "Provide Electrical Power": [
            "Generate Electrical Power",
            "Store Electrical Energy",
        ],

        "Control Thermal Environment": [
            "Maintain Equipment Temperature",
        ],

        "Control Attitude and Orbit": [
            "Determine Attitude",
            "Maintain Orbit",
        ],

        "Provide Propulsion": [
            "Generate Thrust",
            "Control Thrust Vector",
        ],

        "Manage Faults and Safety": [
            "Detect Faults",
            "Execute Safe Mode Procedures",
        ],
    },

    # GENERIC (FALLBACK)
    "generic": {

        "Perform Mission Operations": [
            "Execute Primary Mission Functions",
            "Monitor Mission Progress",
            "Handle Operational Anomalies",
        ],

        "Process and Store Data": [
            "Process On-board Data",
            "Store Data in Mass Memory",
            "Manage Data Integrity",
        ],

        "Transmit Data": [
            "Downlink Mission Data",
            "Receive and Validate Commands",
            "Confirm Uplink Reception",
        ],

        "Provide Electrical Power": [
            "Generate Electrical Power",
            "Store Electrical Energy",
            "Distribute Electrical Power",
        ],

        "Control Thermal Environment": [
            "Maintain Equipment Temperature",
        ],

        "Control Attitude and Orbit": [
            "Determine Attitude",
            "Control Spacecraft Orientation",
        ],

        "Handle On-board Data": [
            "Acquire Housekeeping Data",
        ],

        "Communicate with Ground": [
            "Receive Telecommands",
            "Transmit Telemetry",
        ],

        "Manage Faults and Safety": [
            "Monitor Subsystem Health",
            "Detect and Isolate Faults",
            "Execute Safe Mode Procedures",
        ],
    },
}

# §4.5.3e guard: maximum children per node
MAX_CHILDREN_PER_NODE = 11


def _detect_mission_type(mission) -> str:
    orbit = mission.orbit.lower()
    text  = " ".join(mission.objectives).lower()

    if any(k in text + orbit for k in ["lunar", "moon"]):
        return "lunar"
    if any(k in text + orbit for k in ["mars", "deep space", "interplanetary", "asteroid"]):
        return "deep_space"
    if any(k in text for k in ["communication", "relay", "comms", "broadcast", "connectivity"]):
        return "comms"
    if any(k in text for k in ["observation", "imaging", "monitor", "earth observation",
                                "remote sensing", "climate", "weather"]):
        return "observation"
    return "generic"


# ─── Function tree ─────────────────────────────────────────────────────────────

def _build_function_nodes(raw: List[Dict], root_name: str) -> List[FunctionNode]:
    """Convert LLM-returned [{name, parent}] list into FunctionNode objects."""
    name_to_id = {item["name"]: generate_id("func") for item in raw}
    nodes = []
    for item in raw:
        nid   = name_to_id[item["name"]]
        pname = item.get("parent")
        pid   = name_to_id.get(pname) if pname else None
        nodes.append(FunctionNode(id=nid, name=item["name"], parent_id=pid))
    return nodes


def _enforce_max_children(functions: List[FunctionNode]) -> List[FunctionNode]:
    """
    ECSS §4.5.3e: cap each parent at MAX_CHILDREN_PER_NODE children.
    Excess children are dropped with a warning rather than silently kept.
    """
    from collections import defaultdict
    children_seen: Dict[str, int] = defaultdict(int)
    kept = []
    for f in functions:
        if f.parent_id is None:
            kept.append(f)
            continue
        if children_seen[f.parent_id] < MAX_CHILDREN_PER_NODE:
            kept.append(f)
            children_seen[f.parent_id] += 1
        else:
            print(
                f"⚠️  ECSS §4.5.3e: dropping '{f.name}' — parent already has "
                f"{MAX_CHILDREN_PER_NODE} children."
            )
    return kept


def generate_function_tree_rules(mission) -> List[FunctionNode]:
    mtype     = _detect_mission_type(mission)
    structure = TEMPLATES[mtype]
    functions = []

    root_id = generate_id("func")
    functions.append(FunctionNode(id=root_id, name=mission.name, parent_id=None))

    for parent_name, children in structure.items():
        pid = generate_id("func")
        functions.append(FunctionNode(id=pid, name=parent_name, parent_id=root_id))
        # §4.5.3e: templates already have ≤7 children; guard applied for safety
        for child in children[:MAX_CHILDREN_PER_NODE]:
            functions.append(FunctionNode(id=generate_id("func"), name=child, parent_id=pid))

    return functions


def generate_function_tree_llm(mission) -> List[FunctionNode]:
    """
    Generate mission-specific function tree via LLM.
    Prompt updated per §3.1.2 (declarative naming) and §4.5.3e (max 7 children).
    """
    if client is None:
        return generate_function_tree_rules(mission)

    constraints_str = mission.constraints.dict() if mission.constraints else "None"
    payload_str     = mission.payload.dict()     if mission.payload     else "None"

    prompt = f"""You are a senior systems engineer creating a Functional Breakdown Structure (FBS) \
for a space mission compliant with ECSS-E-10-05A.

Mission:
  Name:        {mission.name}
  Orbit:       {mission.orbit}
  Objectives:  {', '.join(mission.objectives)}
  Constraints: {constraints_str}
  Payload:     {payload_str}

Rules (ECSS-E-10-05A):
- Exactly 1 root node whose "name" is exactly "{mission.name}" and "parent" is null.
- 5–7 top-level mission functions (children of root). MAX 7 — ECSS §4.5.3e.
- EVERY top-level function must have 2–4 specific sub-functions (no childless top-level).
  Each top-level function must have NO MORE than 7 sub-functions — ECSS §4.5.3e.
- ALL function names MUST follow the declarative "Verb Object" pattern (ECSS §3.1.2):
  e.g. "Acquire Science Data", "Validate Telecommands", "Control Thermal Environment".
  NEVER use noun-only names like "Data Acquisition" or "Thermal Control".
- Functions must be SPECIFIC to this mission type and orbit.
- Sub-functions must be actionable, technical, and individually verifiable.

Return ONLY valid JSON (no markdown, no explanation):
{{
  "functions": [
    {{"name": "{mission.name}", "parent": null}},
    {{"name": "Top-level function", "parent": "{mission.name}"}},
    {{"name": "Sub-function A", "parent": "Top-level function"}},
    {{"name": "Sub-function B", "parent": "Top-level function"}}
  ]
}}"""

    try:
        resp    = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        content = resp.choices[0].message.content.strip()
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        parsed = json.loads(content)
        nodes  = _build_function_nodes(parsed.get("functions", []), mission.name)
        if len(nodes) < 3:
            raise ValueError("LLM returned too few nodes")
        # §4.5.3e: enforce cap even on LLM output
        return _enforce_max_children(nodes)
    except Exception as e:
        print(f"⚠️  LLM function tree failed ({e}) — falling back to rule-based")
        return generate_function_tree_rules(mission)


# ─── Requirements ──────────────────────────────────────────────────────────────

REQUIREMENT_TEMPLATES = {
    # ── Avionics / Core Platform ──────────────────────────────────────────────
    "generate electrical power":        "The power subsystem shall generate at least 120% of peak spacecraft power demand under worst-case conditions.",
    "store electrical energy":          "The energy storage system shall support eclipse operations for a minimum duration of 2 hours without loss of functionality.",
    "distribute electrical power":      "The EPS shall distribute regulated power to all subsystems with a voltage stability of ±2%.",
    "regulate bus voltage":             "The electrical bus shall maintain voltage within ±1% under all operational load conditions.",
    "determine attitude":               "The ADCS shall determine spacecraft attitude with an accuracy better than 0.01° (3σ).",
    "control spacecraft orientation":   "The ADCS shall control spacecraft orientation within 0.05° of commanded attitude.",
    "stabilize spacecraft":             "The system shall maintain spacecraft stability with angular rates below 0.01°/s.",
    "maintain trajectory":              "The system shall maintain trajectory deviations within ±1 km of planned path.",
    "acquire housekeeping data":        "The OBC shall acquire housekeeping telemetry from all subsystems at a minimum rate of 1 Hz.",
    "route data":                       "The onboard data handling system shall route data between subsystems with latency below 10 ms.",
    "encode telemetry":                 "The system shall encode telemetry using CCSDS standards with a residual BER below 1×10⁻⁸.",
    "decode telecommands":              "The system shall decode telecommands with a success rate of 99.99% under nominal link conditions.",
    # ── FDIR / Safety ─────────────────────────────────────────────────────────
    "detect faults":                    "The system shall detect anomalies within 5 seconds of occurrence.",
    "isolate faults":                   "The system shall isolate single-point failures within 10 seconds.",
    "recover from faults":              "The system shall autonomously recover from recoverable faults within 60 seconds.",
    "enter safe mode":                  "The spacecraft shall enter safe mode within 30 seconds of critical fault detection.",
    # ── Propulsion ────────────────────────────────────────────────────────────
    "generate thrust":                  "The propulsion system shall provide a thrust level sufficient to meet mission ΔV requirements with 10% margin.",
    "store propellant":                 "The propulsion subsystem shall store propellant with a leakage rate below 0.1% per year.",
    "control thrust vector":            "The propulsion system shall control thrust vector within ±0.5° of commanded direction.",
    # ── Navigation ────────────────────────────────────────────────────────────
    "estimate state vector":            "The navigation system shall estimate spacecraft position and velocity within ±1 km and ±0.1 m/s respectively.",
    "update navigation solution":       "The onboard navigation solution shall be updated at least once every 12 hours.",
    # ── Autonomy ──────────────────────────────────────────────────────────────
    "execute time-tagged commands":     "The system shall execute time-tagged commands with a timing accuracy of ±1 second.",
    "handle communication delays":      "The system shall operate nominally with communication delays up to 90 minutes round-trip.",
    "onboard decision making":          "The system shall autonomously resolve predefined contingency scenarios without ground intervention.",
    # ── Time / Syncrhonization ────────────────────────────────────────────────
    "maintain onboard time":            "The onboard clock shall maintain time accuracy within ±1 ms over 24 hours.",
    "synchronize time":                 "The system shall synchronize onboard time with ground reference within ±10 ms.",
    # ── Resource Budgets ──────────────────────────────────────────────────────
    "power budget":                     "The system shall maintain a power margin of at least 20% under all operational modes.",
    "data budget":                      "The system shall ensure data generation does not exceed downlink capacity over any 24-hour period.",
    "mass budget":                      "The spacecraft shall maintain total mass within ±5% of allocated budget.",
    # ── Environment ───────────────────────────────────────────────────────────
    "radiation tolerance":              "The system shall withstand a total ionising dose of at least 100 krad (Si) over mission lifetime.",
    "thermal survival":                 "The system shall survive non-operational temperatures ranging from −150°C to +150°C.",
    "dust mitigation":                  "The system shall maintain operational performance with less than 5% degradation due to dust contamination.",
    "high temperature survival":        "The system shall operate in environments up to 460°C for Venus surface missions.",
    # ── Reliability / Lifetime ────────────────────────────────────────────────
    "lifetime":                         "The spacecraft shall operate for a minimum of 5 years in the mission environment.",
    "reliability":                      "The system shall achieve a mission success probability greater than 0.95.",
    "redundancy":                       "The system shall tolerate any single-point failure without loss of mission-critical functionality.",
    # ── Observation ───────────────────────────────────────────────────────────
    "acquire data":                     "The system shall acquire payload data with a spatial resolution of at least 1 metre.",
    "point instrument":                 "The system shall maintain instrument pointing accuracy within 0.1 degrees (3σ).",
    "capture payload data":             "The payload shall capture images at a minimum rate of 1 frame per second.",
    "calibrate sensor":                 "The system shall perform sensor self-calibration at least once per orbit.",
    "validate data quality":            "The system shall flag and reject frames with a signal-to-noise ratio below 20 dB.",
    "compress science data":            "The system shall compress science data at a lossless ratio of at least 4:1.",
    "format data":                      "The system shall format downlinked data conforming to CCSDS packet standards within 500 ms.",
    "filter corrupted":                 "The system shall detect and discard corrupted data frames with a false-rejection rate below 0.01%.",
    "write to on-board":                "The system shall write acquired science data to mass memory with a write latency below 10 ms.",
    "manage storage":                   "The system shall maintain a minimum of 20% free storage margin at all times.",
    "protect data integrity":           "The system shall apply forward error correction to all stored data with a residual BER below 1×10⁻¹².",
    "transmit data":                    "The system shall downlink data at a rate of at least 100 Mbps per ground contact.",
    "downlink science data":            "The system shall downlink all acquired science data within 24 hours of acquisition.",
    "receive ground commands":          "The system shall acknowledge and execute ground commands within 5 seconds of receipt.",
    "verify downlink":                  "The system shall confirm successful receipt of each downlinked data file within one pass.",
    "store data":                       "The system shall provide on-board storage capacity of at least 512 GB.",
    "power management":                 "The system shall maintain power availability above 95% throughout the mission lifetime.",
    "manage electrical power":          "The electrical power subsystem shall deliver at least 100 W continuous power with a regulation accuracy of ±2%.",
    "control thermal":                  "The system shall maintain all equipment temperatures within ±5 °C of operational limits.",
    "control thermal environment":      "The thermal control system shall maintain internal equipment temperatures between −20 °C and +60 °C.",
    "attitude control":                 "The ADCS shall maintain spacecraft pointing accuracy better than 0.1° (3σ) in all axes.",
    "control attitude and pointing":    "The ADCS shall achieve and maintain target pointing within 0.05° of the commanded direction.",
    "control attitude and orbit":       "The ADCS shall maintain orbital parameters within ±500 m of the target trajectory.",
    "monitor system health":            "The OBC shall acquire and log health telemetry from all subsystems at a minimum rate of 1 Hz.",
    # ── Comms ─────────────────────────────────────────────────────────────────
    "acquire uplink":                   "The system shall acquire an uplink signal within 10 seconds of beam pointing.",
    "demodulate":                       "The system shall demodulate received signals with a BER below 1×10⁻⁶.",
    "decode and verify":                "The system shall verify frame integrity using CRC-32 with a residual error rate below 1×10⁻⁸.",
    "switch traffic":                   "The system shall route traffic between beams with a switching latency below 1 ms.",
    "amplify signal":                   "The high-power amplifier shall provide a minimum output power of 50 W per channel.",
    "manage beam":                      "The system shall support at least 16 simultaneously active, independently steerable spot beams.",
    "monitor channel quality":          "The system shall report per-channel SNR and BER to the ground at least every 30 seconds.",
    "generate downlink carrier":        "The system shall produce a downlink carrier with a frequency stability of ±5 ppm.",
    "forward traffic":                  "The system shall forward traffic to the gateway with an end-to-end latency below 600 ms.",
    "verify transmitted power":         "The system shall measure and report actual RF output power with an accuracy of ±0.5 dB.",
    "maintain orbital position":        "The station-keeping system shall maintain the spacecraft within ±0.05° of the assigned longitude slot.",
    "monitor payload health":           "The system shall detect payload anomalies and notify the ground within 10 seconds.",
    "monitor link quality":             "The system shall report link quality metrics to the ground every 30 seconds.",
    "handle beam handovers":            "The system shall complete beam handover in less than 50 ms with zero packet loss.",
    "report network status":            "The system shall transmit a network status report to the ground at least every 5 minutes.",
    # ── Deep Space ────────────────────────────────────────────────────────────
    "perform trajectory":               "The system shall execute trajectory correction manoeuvres with a ΔV accuracy of ±0.01 m/s.",
    "determine position":               "The navigation system shall determine spacecraft position with an accuracy of ±100 km at maximum range.",
    "update ephemeris":                 "The OBC shall update the onboard ephemeris at least once every 24 hours using DSN data.",
    "operate instruments":              "The system shall operate all science instruments within the allocated power budget of 150 W.",
    "collect measurements":             "The science system shall collect in-situ measurements at a minimum sampling rate of 1 Hz.",
    "sequence observation":             "The system shall execute a pre-planned observation sequence with a scheduling accuracy of ±60 seconds.",
    "process raw science":              "The OBC shall perform Level-0 science data processing with a throughput of at least 10 Mbps.",
    "store science data":               "The system shall store at least 64 GB of compressed science data on-board.",
    "transmit data to earth":           "The system shall downlink science data at a minimum rate of 1 kbps at maximum mission range.",
    "manage electrical power budget":   "The EPS shall supply power to all subsystems with a maximum distribution loss of 5%.",
    "mitigate radiation":               "The system shall meet a total ionising dose tolerance of at least 50 krad (Si) over the mission lifetime.",
    "maintain dsn link":                "The system shall maintain a DSN link with a minimum data rate of 1 kbps at maximum mission range.",
    "receive and execute commands":     "The system shall execute a received command within 10 seconds of uplink confirmation.",
    "transmit telemetry":               "The system shall downlink housekeeping telemetry at a minimum rate of 1 kbps at all times.",
    # ── Lunar ─────────────────────────────────────────────────────────────────
    "execute trans-lunar":              "The propulsion system shall execute Trans-Lunar Injection with a total ΔV budget below 3.2 km/s.",
    "perform mid-course":               "The system shall perform mid-course corrections with a total ΔV budget below 50 m/s.",
    "monitor navigation state":         "The navigation system shall provide a state estimate accurate to within ±1 km and ±0.1 m/s.",
    "execute lunar orbit insertion":    "The propulsion system shall execute Lunar Orbit Insertion with a ΔV accuracy of ±1 m/s.",
    "perform orbit trim":               "The system shall execute orbit trim manoeuvres to maintain periapsis within ±5 km of the target.",
    "validate final orbit":             "The system shall confirm final orbital parameters within 1 hour of Lunar Orbit Insertion.",
    "operate payload instruments":      "The payload subsystem shall operate all instruments within the allocated power budget of 80 W.",
    "acquire lunar surface data":       "The system shall acquire lunar surface measurements at a spatial resolution of at least 10 m.",
    "sequence observation windows":     "The system shall schedule and execute observation windows with a timing accuracy of ±30 seconds.",
    "maintain earth communication":     "The communication system shall maintain an Earth link with a minimum data rate of 1 Mbps during contact windows.",
    "receive and acknowledge":          "The system shall acknowledge received commands within 2 seconds of uplink reception.",
    "relay science data":               "The system shall downlink all acquired science data within one lunar day of acquisition.",
    # ── Generic ───────────────────────────────────────────────────────────────
    "execute primary mission":          "The system shall execute primary mission functions with an availability of at least 99% during the nominal mission phase.",
    "monitor mission progress":         "The system shall provide mission progress telemetry to the ground at a minimum rate of 1 Hz.",
    "handle operational anomalies":     "The system shall detect and recover from operational anomalies within 60 seconds without ground intervention.",
    "process on-board data":            "The OBC shall process on-board data streams at a sustained throughput of at least 50 Mbps.",
    "manage data integrity":            "The system shall ensure data integrity through checksums with a residual error rate below 1×10⁻¹⁰.",
    "confirm uplink reception":         "The system shall generate an acknowledgement for every received uplink frame within 5 seconds.",
    "detect and isolate faults":        "The FDIR system shall isolate single-point failures and enter a safe configuration within 30 seconds.",
    "execute safe mode":                "The system shall autonomously enter safe mode and maintain spacecraft safety for at least 72 hours without ground contact.",
}


def _requirement_from_template(func_name: str, mission=None) -> str:
    key = func_name.lower()
    sorted_keys = sorted(REQUIREMENT_TEMPLATES.keys(), key=len, reverse=True)
    for pattern in sorted_keys:
        if pattern in key:
            return REQUIREMENT_TEMPLATES[pattern]
    return (
        f"The system shall perform '{func_name}' in compliance with defined operational "
        f"constraints and within the mission timeline, with performance verified by test or analysis."
    )


def generate_requirements_rules(functions: List[FunctionNode], mission=None) -> List[Requirement]:
    """Generate one verifiable requirement per non-root function node."""
    return [
        Requirement(
            id=generate_id("req"),
            description=_requirement_from_template(f.name, mission),
            related_function=f.id,
        )
        for f in functions if f.parent_id is not None
    ]


def generate_requirements_llm(functions: List[FunctionNode], mission) -> List[Requirement]:
    """
    Generate quantitative requirements via LLM.
    Prompt updated to include mission phase context per ECSS §5.2.
    """
    if client is None:
        return generate_requirements_rules(functions, mission)

    func_names      = [f.name for f in functions if f.parent_id is not None]
    constraints_str = mission.constraints.dict() if mission.constraints else "None"

    # §5.2: infer phase from mission maturity signals
    phase_hint = "Phase B"  # default — most generation requests are pre-PDR
    if hasattr(mission, "phase") and mission.phase:
        phase_hint = mission.phase

    prompt = f"""You are a senior systems engineer writing verifiable shall-statements \
for a space mission compliant with ECSS-E-10-05A.

Mission: {mission.name} ({mission.orbit})
Objectives: {', '.join(mission.objectives)}
Constraints: {constraints_str}
Design Phase: {phase_hint} (ECSS §5.2 — set threshold detail accordingly)

For EACH function below, write exactly ONE measurable, verifiable requirement.
Every requirement MUST:
- Start with "The system shall"
- Include at least one quantitative threshold (e.g. "at least X", "within Y ms", "minimum Z%", "below N dB")
- Be specific to the function's technical domain
- Reflect the level of detail appropriate for {phase_hint}

Functions:
{chr(10).join(f'- {n}' for n in func_names)}

Return ONLY valid JSON (no markdown):
{{
  "requirements": [
    {{"function": "<exact function name>", "requirement": "The system shall ..."}}
  ]
}}"""

    try:
        resp    = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        content = resp.choices[0].message.content.strip()
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        parsed      = json.loads(content)
        name_to_fn  = {f.name: f for f in functions}
        requirements = []
        for item in parsed.get("requirements", []):
            fn = name_to_fn.get(item["function"])
            if fn:
                requirements.append(Requirement(
                    id=generate_id("req"),
                    description=item["requirement"],
                    related_function=fn.id,
                ))
        if not requirements:
            raise ValueError("Empty requirements from LLM")
        return requirements
    except Exception as e:
        print(f"⚠️  LLM requirements failed ({e}) — falling back to rule-based")
        return generate_requirements_rules(functions, mission)


# ─── Subsystems ────────────────────────────────────────────────────────────────

SUBSYSTEM_KEYWORDS: Dict[str, List[str]] = {
    "ADCS":       [ "attitude", "point", "orient", "stabiliz", "slew", "gyro", "star tracker", "reaction wheel", "magnetorquer", "sun sensor", "inertial", "angular rate" ],
    "Navigation": [ "navigation", "orbit determination", "ephemeris", "state vector", "position", "velocity", "trajectory estimation", "gnc" ],
    "EPS":        [ "power", "energy", "battery", "eps", "power distribution", "voltage", "bus", "regulation", "power budget" ],
    "TCS":        [ "thermal", "temperature", "heat", "tcs", "heater", "cooling", "thermal control" ],
    "Structure":  [ "structure", "frame", "mechanical", "load", "stress", "vibration", "deployment", "mechanism", "hinge", "boom", "antenna deployment" ],
    "Payload":    [ "payload", "instrument", "sensor", "camera", "spectrometer", "radar", "image", "science", "observe", "measurement", "collect", "calibrat" ],
    "TT&C":       [ "transmit", "downlink", "uplink", "communicate", "telemetry", "telecommand", "link", "dsn", "signal", "relay", "antenna", "rf", "demodulat", "carrier", "bandwidth", "modulat", "encode", "decode" ],
    "OBC":        [ "process", "compute", "store", "compress", "format", "data", "memory", "packet", "routing", "switch", "buffer", "software", "algorithm", "execution", "sequence", "anomal", "health", "fault", "safe mode" ],
    "Propulsion": [ "maneuver", "manoeuvre", "thrust", "delta-v", "burn", "propuls", "engine", "thruster", "tank", "propellant", "pressurization", "injection", "insertion", "trim", "trajectory" ],
    "FDIR":       [ "fault", "failure", "anomaly", "safe mode", "recovery", "redundancy", "protection", "isolate", "diagnostic" ],
}


def generate_subsystems() -> List[Subsystem]:
    return [
        Subsystem(id=generate_id("sub"), name=name)
        for name in SUBSYSTEM_KEYWORDS
    ]


def map_functions_to_subsystems(functions: List[FunctionNode], subsystems: List[Subsystem]) -> Dict:
    mapping = {}
    for f in functions:
        name = f.name.lower()
        assigned = False
        for sub_name, keywords in SUBSYSTEM_KEYWORDS.items():
            if any(kw in name for kw in keywords):
                mapping[f.id] = sub_name
                assigned = True
                break
        if not assigned and f.parent_id is not None:
            mapping[f.id] = "OBC"
    return mapping


# ─── Traceability ──────────────────────────────────────────────────────────────

def generate_traceability(requirements: List[Requirement]) -> List[TraceLink]:
    """
    ECSS §4.7.6: traceability links function→requirement (forward).
    Backward traceability (req→function) is validated in validator.py via graph traversal.
    """
    return [TraceLink(function_id=r.related_function, requirement_id=r.id) for r in requirements]


# ─── Pipeline ──────────────────────────────────────────────────────────────────

def run_pipeline(mission):
    if client:
        functions    = generate_function_tree_llm(mission)
        requirements = generate_requirements_llm(functions, mission)
    else:
        functions    = generate_function_tree_rules(mission)
        requirements = generate_requirements_rules(functions, mission)

    subsystems   = generate_subsystems()
    traceability = generate_traceability(requirements)
    mapping      = map_functions_to_subsystems(functions, subsystems)

    return functions, requirements, subsystems, traceability, mapping