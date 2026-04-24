# PeriapSys
Meet **PeriapSys Architect**, an AI-powered mission architecture and systems engineering platform for early-phase spacecraft design, enabling rapid functional decomposition, requirement synthesis, and traceability with integrated orbital analysis.

Designed for **Phase 0 / Phase A studies**, PeriapSys enables engineers to move from mission concept to structured system architecture in seconds—while preserving rigor aligned with ECSS-E-10-05A functional engineering standards.

---

## Design Philosophy
### 1. Engineering-first AI
AI augments systems engineering; it does not replace it. Note that the use of an LLM model is optional. That is, if no API key is entered (with available tokens), no LLM-powered suggestions will be provided.

### 2. Standards-aligned
Outputs are grounded in ECSS functional engineering standards.

### 3. Speed with structure
Compress weeks of Phase 0 work into minutes without losing rigor.


---

## Key Capabilities

### 🧠 AI-Driven Functional Decomposition
- Generates **Functional Breakdown Structures (FBS)** from mission objectives
- Enforces **verb–object declarative function naming** (ECSS §3.1.2)
- Automatically structures multi-level decomposition trees

---

### 🔗 Full Traceability Graph
- Bidirectional traceability:
  - Function → Requirement (satisfies)
  - Parent ↔ Child (decomposition)
- Validates compliance with **ECSS §4.7.6**

---

### 📐 Requirements Generation & Quality Scoring
- Generates measurable, engineering-grade requirements
- Evaluates requirement quality (quantitative thresholds, units, clarity)
- Flags vague or non-compliant requirements automatically

---

### ⚠️ Systems Engineering Validation (ECSS-Aligned)
Automated checks include:
- Decomposition limits (≤11 children per node)
- Naming compliance — §3.1.2
- Traceability completeness — §4.7.6
- Requirement measurability — §4.5.1d

---

### 🔥 Critical Function Identification (FMECA-ready)
- Flags safety- and mission-critical functions
- Identifies candidates for failure analysis (FMECA)
- Based on ECSS §4.8.1

---

### 📊 Functional Matrix Generation
- Maps:
  - Level-1 functions  
  - Level-2 functions  
  - Associated requirements  
- Supports early architecture trade studies  
- ECSS §4.6.3 compliant  

---

### 🔌 Functional Interface Identification
- Infers data/control/power flows between functions  
- Highlights subsystem interaction early  
- ECSS §4.5.3i compliant  

---

### 🛰️ Orbital Context Integration
- Supports:
  - LEO, GEO, SSO, HEO
  - Lunar, Mars, deep space missions
- Resolves orbital elements and visualizes mission geometry

---

### 🌐 Interactive System Graph
- Visual graph of:
  - Functions
  - Subfunctions
  - Requirements
  - Subsystems
  - Interfaces
- Built with React Flow + Dagre layout

---

### 💾 Mission Persistence & Retrieval
- Store and reload mission architectures  
- Includes:
  - Graph
  - Validation results
  - AI insights
  - Functional matrix
- Backed by SQLite + SQLAlchemy

---

### 🤖 AI Reasoning & Suggestions
- Identifies:
  - Missing functions
  - Weak requirements
  - Architectural gaps
- Suggests improvements interactively

---

## Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/your-org/periapsys-architect.git
cd periapsys-architect
```
### 2. Backend setup
```bash
pip install -r requirements.txt
uvicorn main:app --reload
```
### 3. Frontend setup
```bash
cd frontend
npm install
npm run dev
```
### 4. Enable AI generation (optional)
```bash
export OPENAI_API_KEY=your_key_here
```
