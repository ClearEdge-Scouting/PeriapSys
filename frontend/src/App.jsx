import { useState, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { generateSystem, applySuggestion, listMissions, loadMission, deleteMission } from "./api";
import { convertToFlow, getUpstream, getDownstream } from "./graphUtils";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:          "#04080f",
  surface:     "#080f1c",
  panel:       "#0b1524",
  border:      "#152236",
  borderHi:    "#1e3a5f",
  accent:      "#00b4d8",
  accentDark:  "#007ea3",
  amber:       "#f59e0b",
  green:       "#22c55e",
  red:         "#ef4444",
  text:        "#b8cfe0",
  textDim:     "#4d6880",
  textBright:  "#e2f0fb",
  mono:        "'Courier New', monospace",
  sans:        "'Segoe UI', system-ui, -apple-system, sans-serif",
};

const MU = {
  Earth:   398600.4418,   // km^3/s^2
  Moon:    4902.800066,
  Mars:    42828.3,
  Venus:   324859,
  Mercury: 22032,
  Jupiter: 126686534,
  Saturn:  37931187,
  Uranus:  5793939,
  Neptune: 6836529,
};

// ── Rotation rates (rad/s) for each body ──────────────────────────────────────
const BODY_ROTATION_RATE = {
  Earth:   7.2921150e-5,   // sidereal
  Moon:    2.6617e-6,
  Mars:    7.0882e-5,
  Venus:  -2.9924e-7,      // retrograde
  Mercury: 1.2404e-6,
  Jupiter: 1.7585e-4,
  Saturn:  1.6378e-4,
  Uranus: -1.0120e-4,      // retrograde
  Neptune: 1.0834e-4,
};

// Rotation angle of body at simulation time t [rad]
function bodyRotAngle(body, t) {
  return (BODY_ROTATION_RATE[body] || BODY_ROTATION_RATE.Earth) * t;
}

// Orbits that are "in orbit" around a celestial body (not landers/stations)
const ORBITAL_ORBIT_TYPES = [ "LEO", "MEO", "GEO", "SSO", "HEO", "Lunar Orbit", "Mars Orbit", "Venus Orbit",
  "Mercury Orbit", "Jupiter Orbit", "Saturn Orbit", "Uranus Orbit", "Neptune Orbit" ];
const ORBIT_OPTS = [
  "LEO", "MEO", "GEO", "SSO", "HEO",

  "Lunar Orbit",
  "Mars Orbit",
  "Venus Orbit",
  "Mercury Orbit",
  "Jupiter Orbit",
  "Saturn Orbit",
  "Uranus Orbit",
  "Neptune Orbit",

  "Deep Space",
  "L1/L2 Point"
];

const PAYLOAD_OPTS = ["Optical Camera", "SAR", "Hyperspectral Imager", "Comms Transponder",
                      "Science Instruments", "LiDAR", "Weather Sensor", "Navigation Payload"];

// Default orbital element assumptions by orbit type
const ORBIT_DEFAULTS = {
  LEO:         { sma: 6771,   ecc: 0.001, inc: 51.6,  raan: 0,   aop: 0,   body: "Earth",  bodyRadius: 6371,  color: "#1e88e5" },
  MEO:         { sma: 20200,  ecc: 0.001, inc: 55,    raan: 0,   aop: 0,   body: "Earth",  bodyRadius: 6371,  color: "#1e88e5" },
  GEO:         { sma: 42164,  ecc: 0.0,   inc: 0,     raan: 0,   aop: 0,   body: "Earth",  bodyRadius: 6371,  color: "#1e88e5" },
  SSO:         { sma: 6878,   ecc: 0.001, inc: 97.8,  raan: 0,   aop: 0,   body: "Earth",  bodyRadius: 6371,  color: "#1e88e5" },
  HEO:         { sma: 26560,  ecc: 0.74,  inc: 63.4,  raan: 0,   aop: 270, body: "Earth",  bodyRadius: 6371,  color: "#1e88e5" },
  "Lunar Orbit": { sma: 1837, ecc: 0.001, inc: 90,    raan: 0,   aop: 0,   body: "Moon",   bodyRadius: 1737,  color: "#9e9e9e" },
  "Mars Orbit":  { sma: 3596, ecc: 0.001, inc: 93,    raan: 0,   aop: 0,   body: "Mars",   bodyRadius: 3390,  color: "#e64a19" },
  "Venus Orbit": { sma: 6500, ecc: 0.001, inc: 90,    raan: 0,   aop: 0,   body: "Venus",  bodyRadius: 6052,  color: "#d4a373" },
  "Mercury Orbit": { sma: 3000, ecc: 0.001, inc: 90,  raan: 0,   aop: 0,   body: "Mercury", bodyRadius: 2440, color: "#9e9e9e" },
  "Jupiter Orbit": { sma: 80000, ecc: 0.01, inc: 10,  raan: 0,   aop: 0,   body: "Jupiter", bodyRadius: 69911, color: "#d2b48c" },
  "Saturn Orbit": { sma: 120000, ecc: 0.01, inc: 10,  raan: 0,   aop: 0,   body: "Saturn", bodyRadius: 58232, color: "#e6d3a3" },
  "Uranus Orbit": { sma: 50000, ecc: 0.01, inc: 98,   raan: 0,   aop: 0,   body: "Uranus", bodyRadius: 25362, color: "#7fdbff" },
  "Neptune Orbit": { sma: 50000, ecc: 0.01, inc: 30,  raan: 0,   aop: 0,   body: "Neptune", bodyRadius: 24622, color: "#4169e1" },
};

function isOrbitalMission(orbit) {
  return ORBITAL_ORBIT_TYPES.includes(orbit);
}

// Resolve orbital elements: merge user inputs with defaults, fill gaps
function resolveOrbitalElements(orbit, userElems) {
  const defaults = ORBIT_DEFAULTS[orbit] || ORBIT_DEFAULTS["LEO"];
  const resolved = { ...defaults };

  if (userElems.sma   && !isNaN(parseFloat(userElems.sma)))  resolved.sma  = parseFloat(userElems.sma);
  if (userElems.ecc   && !isNaN(parseFloat(userElems.ecc)))  resolved.ecc  = parseFloat(userElems.ecc);
  if (userElems.inc   && !isNaN(parseFloat(userElems.inc)))  resolved.inc  = parseFloat(userElems.inc);
  if (userElems.raan  && !isNaN(parseFloat(userElems.raan))) resolved.raan = parseFloat(userElems.raan);
  if (userElems.aop   && !isNaN(parseFloat(userElems.aop)))  resolved.aop  = parseFloat(userElems.aop);

  return resolved;
}

// ─── Reusable micro-components ────────────────────────────────────────────────

function Label({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.14em",
      textTransform: "uppercase", color: T.textDim,
      fontFamily: T.sans, marginBottom: 7,
    }}>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, style = {}, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 5, color: T.textBright, fontFamily: T.sans,
        fontSize: 13, padding: "9px 13px", width: "100%",
        boxSizing: "border-box", outline: "none",
        transition: "border-color 0.15s",
        ...style,
      }}
      onFocus={e => (e.target.style.borderColor = T.accentDark)}
      onBlur={e  => (e.target.style.borderColor = T.border)}
    />
  );
}

function Btn({ children, onClick, variant = "primary", style = {}, disabled = false }) {
  const base = {
    borderRadius: 5, cursor: disabled ? "default" : "pointer",
    fontFamily: T.sans, fontSize: 12, fontWeight: 600,
    letterSpacing: "0.04em", border: "1px solid",
    padding: "8px 16px", transition: "all 0.15s",
    opacity: disabled ? 0.4 : 1,
  };
  const variants = {
    primary: { background: T.accentDark, borderColor: T.accent,    color: T.textBright },
    ghost:   { background: "transparent", borderColor: T.border,   color: T.textDim    },
    success: { background: `${T.green}1a`, borderColor: `${T.green}55`, color: T.green },
    danger:  { background: "transparent", borderColor: `${T.red}44`,   color: T.red   },
  };
  return (
    <button onClick={disabled ? undefined : onClick}
      style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

function PanelSection({ title, accent, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 9, fontWeight: 800, letterSpacing: "0.18em",
        textTransform: "uppercase", fontFamily: T.sans,
        color: accent ? T.accent : T.textDim,
        borderBottom: `1px solid ${T.border}`, paddingBottom: 6, marginBottom: 10,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── Toggle button helper ──────────────────────────────────────────────────────
function ToggleBtn({ active, onClick, children, color, style = {} }) {
  const c = color || T.accent;
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? `${c}22` : "transparent",
        border: `1px solid ${active ? c : T.border}`,
        borderRadius: 5, color: active ? c : T.textDim,
        fontFamily: T.sans, fontSize: 10, fontWeight: 600,
        padding: "5px 10px", cursor: "pointer",
        transition: "all 0.15s", letterSpacing: "0.04em",
        display: "flex", alignItems: "center", gap: 5,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ─── 3D Orbital Viewer ─────────────────────────────────────────────────────────

function OrbitalViewer({ orbitalElements, layers, toolMode, scrubT, isPlaying, measurePts, onMeasurePt, frameMode, retrograde }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const toolModeRef = useRef(toolMode);
  useEffect(() => { toolModeRef.current = toolMode; }, [toolMode]);
  const onMeasurePtRef = useRef(onMeasurePt);
  useEffect(() => { onMeasurePtRef.current = onMeasurePt; }, [onMeasurePt]);
  const frameModeRef = useRef(frameMode);
  useEffect(() => {
    frameModeRef.current = frameMode;
    if (sceneRef.current?.setFrameMode) sceneRef.current.setFrameMode(frameMode);
  }, [frameMode]);
  const retrogradeRef = useRef(retrograde);
  useEffect(() => { retrogradeRef.current = retrograde; }, [retrograde]);
  // Always-fresh ref so setLayers works even when called before Three.js finishes loading
  const layersRef = useRef(layers);
  useEffect(() => { layersRef.current = layers; }, [layers]);

  useEffect(() => {
    if (!mountRef.current || !orbitalElements) return;

    // Always store a cleanup reference so we can tear down the old scene
    // regardless of whether THREE.js was already loaded.
    let cleanupFn = null;
    const runInit = () => {
      // Tear down any previous scene before building a new one
      if (sceneRef.current?.cleanup) sceneRef.current.cleanup();
      initScene();
      cleanupFn = () => { if (sceneRef.current?.cleanup) sceneRef.current.cleanup(); };
    };

    if (window.THREE) {
      runInit();
    } else {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
      script.onload = runInit;
      document.head.appendChild(script);
    }

    return () => { cleanupFn?.(); };
  }, [orbitalElements]);

  useEffect(() => {
    if (sceneRef.current?.updateOrbit) sceneRef.current.updateOrbit(orbitalElements);
  }, [orbitalElements]);

  // Sync layer visibility into the scene without rebuilding
  useEffect(() => {
    layersRef.current = layers;
    if (sceneRef.current?.setLayers) sceneRef.current.setLayers(layers);
  }, [layers]);

  // Sync scrub time when paused
  useEffect(() => {
    if (!isPlaying && sceneRef.current?.setScrubT) sceneRef.current.setScrubT(scrubT);
  }, [scrubT, isPlaying]);

  useEffect(() => {
    if (sceneRef.current?.setPlaying) sceneRef.current.setPlaying(isPlaying);
  }, [isPlaying]);

  useEffect(() => {
    if (sceneRef.current?.setMeasurePts) sceneRef.current.setMeasurePts(measurePts);
  }, [measurePts]);

  // Persist texture cache across re-renders so textures are not re-downloaded.
  const textureCacheRef = useRef({});

  function loadTexture(THREE, url) {
    if (!url) return null;
    const cache = textureCacheRef.current;
    if (cache[url]) return cache[url];
    const tex = new THREE.TextureLoader().load(url);
    cache[url] = tex;
    return tex;
  }

  // ── Planet texture registry ──
  const PLANET_TEXTURES = {
    Earth: {
      map: "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg",
      spec: "https://threejs.org/examples/textures/planets/earth_specular_2048.jpg",
      normal: "https://threejs.org/examples/textures/planets/earth_normal_2048.jpg",
    },
    Moon: {
      map: "https://threejs.org/examples/textures/planets/moon_1024.jpg",
    },
    Mars: {
      map: "https://imgs.search.brave.com/SA2leb-eHMlmpYzAhX4UDFpFcetdNWSnWEe8_4xLGPg/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9pLnBp/bmltZy5jb20vb3Jp/Z2luYWxzL2U0LzQ3/L2NiL2U0NDdjYmQ5/ODA4NTY1MDkxODcy/ZWU4MjE2MzEzZWRl/LmpwZw",
    },
    Venus: {
      map: "https://upload.wikimedia.org/wikipedia/commons/1/19/Cylindrical_Map_of_Venus.jpg",
    },
    Mercury: {
      map: "https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/p/i/a/1/PIA17386-1.jpg",
    },
    Jupiter: {
      map: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar/2023/09/p/PIA07782.jpg?w=3601&h=1801&fit=clip&crop=faces%2Cfocalpoint",
    },
    Saturn: {
      map: "https://upload.wikimedia.org/wikipedia/commons/1/1e/Solarsystemscope_texture_8k_saturn.jpg",
    },
    Uranus: {
      map: "https://threejs.org/examples/textures/planets/uranus.jpg",
    },
    Neptune: {
      map: "https://threejs.org/examples/textures/planets/neptune.jpg",
    },
  };

  function solveKepler(M, e, tol = 1e-6) {
    let E = M; // initial guess
    for (let i = 0; i < 10; i++) {
      const f  = E - e * Math.sin(E) - M;
      const fp = 1 - e * Math.cos(E);
      E = E - f / fp;
      if (Math.abs(f) < tol) break;
    }
    return E;
  }

  function getStateVector(t, elems, scale) {
    const { sma, ecc, inc, raan, aop, body } = elems;

    const mu = MU[body] || MU.Earth;

    const a = sma * scale;

    // Mean motion
    const n = Math.sqrt(mu / Math.pow(sma, 3)); // rad/s

    // Mean anomaly — negate for retrograde orbit
    const dir = retrogradeRef.current ? -1 : 1;
    const M = dir * (n * t) % (2 * Math.PI);

    // Solve Kepler
    const E = solveKepler(M, ecc);

    // True anomaly
    const nu = 2 * Math.atan2(
      Math.sqrt(1 + ecc) * Math.sin(E / 2),
      Math.sqrt(1 - ecc) * Math.cos(E / 2)
    );

    // Radius
    const r = a * (1 - ecc * Math.cos(E));

    // Perifocal coords
    const x = r * Math.cos(nu);
    const z = r * Math.sin(nu);

    const pos = new THREE.Vector3(x, 0, z);

    // Rotations
    const incR  = inc  * Math.PI / 180;
    const raanR = raan * Math.PI / 180;
    const aopR  = aop  * Math.PI / 180;

    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0,1,0), raanR)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), incR))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), aopR));

    return pos.applyQuaternion(q);
  }

  // Returns the nadir half-angle η — the angle from satellite nadir to the geometric
  // horizon. In the right triangle (right angle at the tangent point on the surface):
  //   sin(η) = R / r   where r = sma (distance from body centre to satellite).
  // arccos(R/r) would give the Earth-central angle λ, NOT the satellite nadir angle.
  function getCoverageAngle(bodyRadius, sma) {
    return Math.asin(bodyRadius / sma);
  }

  function initScene() {
    const THREE = window.THREE;
    if (!THREE || !mountRef.current) return;

    const container = mountRef.current;
    const W = container.clientWidth;
    const H = container.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Scene + Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.01, 500000);

    // Compute scale: normalise so body radius = 1 unit on screen
    const bodyR    = orbitalElements.bodyRadius;
    const scale    = 1 / bodyR; // 1 unit = bodyR km

    camera.position.set(0, orbitalElements.sma * scale * 2.2, orbitalElements.sma * scale * 1.8);
    camera.lookAt(0, 0, 0);

    // Ambient + directional (sun-like)
    scene.add(new THREE.AmbientLight(0x222222, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(100, 0, 0);
    scene.add(sun);

    // ── Starfield ──
    const starGeo = new THREE.BufferGeometry();
    const starCount = 3000;
    const starVerts = [];
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = orbitalElements.sma * scale * 50; // 50x orbit size
      starVerts.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starVerts, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 150 * scale })));

    // ── Planet body ──
    const planetR = bodyR * scale;
    const bodyColor = new THREE.Color(orbitalElements.color || "#1e88e5");
    const planetGeo = new THREE.SphereGeometry(planetR, 64, 64);

    // Resolve textures for this body
    const texSet = PLANET_TEXTURES[orbitalElements.body] || {};
    const map     = loadTexture(THREE, texSet.map);
    const specMap = loadTexture(THREE, texSet.spec);
    const normal  = loadTexture(THREE, texSet.normal);

    // Fallback color (used if no texture exists)
    const fallbackColor = new THREE.Color(orbitalElements.color || "#1e88e5");

    let planetMat;

    if (map) {
      planetMat = new THREE.MeshPhongMaterial({
        map: map,
        specularMap: specMap || null,
        normalMap: normal || null,
        shininess: 15,
      });
    } else {
      planetMat = new THREE.MeshPhongMaterial({
        color: fallbackColor,
        emissive: fallbackColor.clone().multiplyScalar(0.1),
      });
    }

    const planet = new THREE.Mesh(planetGeo, planetMat);
    scene.add(planet);

    // Atmosphere glow (subtle additive sphere)
    if (orbitalElements.body === "Earth") {
      const atmGeo = new THREE.SphereGeometry(planetR * 1.02, 32, 32);
      const atmMat = new THREE.MeshPhongMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.1,
        side: THREE.FrontSide,
      });
      scene.add(new THREE.Mesh(atmGeo, atmMat));
    }

    // Saturnian rings
    if (orbitalElements.body === "Saturn") {
      const inner = planetR * 1.4;
      const outer = planetR * 2.2;

      const ringGeo = new THREE.RingGeometry(inner, outer, 256);

      // --- UV remap for strip texture ---
      const pos = ringGeo.attributes.position;
      const uv = [];

      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);

        const r = Math.sqrt(x * x + y * y);

        // Normalize radius → [0,1]
        const u = (r - inner) / (outer - inner);

        // Constant V (middle of texture strip)
        const v = 0.5;

        uv.push(u, v);
      }

      ringGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));

      const ringTex = loadTexture(
        THREE,
        "https://upload.wikimedia.org/wikipedia/commons/2/29/Solarsystemscope_texture_8k_saturn_ring_alpha.png"
      );

      const ringMat = new THREE.MeshBasicMaterial({
        map: ringTex,
        alphaMap: ringTex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false, // prevents z-fighting artifacts
      });

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      scene.add(ring);
    }

    // ── Axial tilt indicator (equatorial ring) ──
    const eqGeo = new THREE.TorusGeometry(planetR * 1.05, planetR * 0.004, 8, 128);
    const eqMat = new THREE.MeshBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.5 });
    scene.add(new THREE.Mesh(eqGeo, eqMat));

    // ── Build orbit path + satellite from elements ──
    let orbitLine, satellite;

    function buildOrbit(elems) {
      if (orbitLine) scene.remove(orbitLine);
      if (satellite) scene.remove(satellite);

      const { sma, ecc, inc, raan, aop } = elems;
      const a = sma * scale;
      const b = a * Math.sqrt(1 - ecc * ecc);
      const c = a * ecc; // distance from center to focus

      // Generate ellipse points in the orbital plane (perifocal)
      const pts = [];
      const N = 360;
      for (let i = 0; i <= N; i++) {
        const nu = (i / N) * Math.PI * 2;
        // Polar form: r = a(1-e²)/(1+e·cos(nu))
        const r = a * (1 - ecc * ecc) / (1 + ecc * Math.cos(nu));
        // In perifocal frame (x toward periapsis)
        pts.push(new THREE.Vector3(r * Math.cos(nu), 0, r * Math.sin(nu)));
      }

      // Apply rotations: AoP (ω), Inc (i), RAAN (Ω) — Euler ZXZ in THREE conventions
      const incR  = inc  * Math.PI / 180;
      const raanR = raan * Math.PI / 180;
      const aopR  = aop  * Math.PI / 180;

      // Rotation matrix: R = Rz(RAAN) * Rx(inc) * Rz(AoP)
      const Rz_raan = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), raanR);
      const Rx_inc  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), incR);
      const Rz_aop  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), aopR);
      const q = Rz_raan.multiply(Rx_inc).multiply(Rz_aop);

      const rotatedPts = pts.map(p => p.clone().applyQuaternion(q));

      const geo = new THREE.BufferGeometry().setFromPoints(rotatedPts);
      orbitLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x00b4d8, transparent: true, opacity: 0.7, linewidth: 2,
      }));
      scene.add(orbitLine);

      // Satellite at true anomaly = 45°
      const nuSat = Math.PI / 4;
      const rSat  = a * (1 - ecc * ecc) / (1 + ecc * Math.cos(nuSat));
      const satPeri = new THREE.Vector3(rSat * Math.cos(nuSat), 0, rSat * Math.sin(nuSat));
      const satPos  = satPeri.clone().applyQuaternion(q.clone());

      const satGeo = new THREE.SphereGeometry(planetR * 0.025, 16, 16);
      const satMat = new THREE.MeshPhongMaterial({ color: 0xffd700, emissive: 0xffa000 });
      satellite = new THREE.Mesh(satGeo, satMat);
      satellite.position.copy(satPos);
      scene.add(satellite);

      // Solar panels (two thin boxes)
      const panelGeo = new THREE.BoxGeometry(planetR * 0.06, planetR * 0.004, planetR * 0.018);
      const panelMat = new THREE.MeshPhongMaterial({ color: 0x1565c0, emissive: 0x0d47a1 });
      [-1, 1].forEach(side => {
        const panel = new THREE.Mesh(panelGeo, panelMat);
        panel.position.set(side * planetR * 0.055, 0, 0);
        satellite.add(panel);
      });
    }

    buildOrbit(orbitalElements);

    // ── Layer objects created per-orbit ──────────────────────────────────────
    // These are thin wrappers around scene objects that we can show/hide.
    let orbitPlaneObj = null;
    let velocityArrow = null;
    let ascNodeArrow  = null;
    let descNodeArrow = null;
    // Measurement markers
    let measMarkerA = null, measMarkerB = null, measLine = null;

    function buildLayerObjects(elems) {
      // Remove old
      if (orbitPlaneObj) scene.remove(orbitPlaneObj);
      if (velocityArrow) scene.remove(velocityArrow);
      if (ascNodeArrow)  scene.remove(ascNodeArrow);
      if (descNodeArrow) scene.remove(descNodeArrow);

      const { sma, ecc, inc, raan, aop } = elems;
      const a = sma * scale;
      const incR  = inc  * Math.PI / 180;
      const raanR = raan * Math.PI / 180;
      const aopR  = aop  * Math.PI / 180;
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0,1,0), raanR)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), incR))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), aopR));

      // Orbit plane disc
      const planeGeo = new THREE.CircleGeometry(a * 1.05, 128);
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0x00b4d8, transparent: true, opacity: 0.07,
        side: THREE.DoubleSide, depthWrite: false,
      });
      orbitPlaneObj = new THREE.Mesh(planeGeo, planeMat);
      // THREE.CircleGeometry lies in the XY plane (normal = +Z).
      // The orbit is built in the XZ plane (normal = +Y), so pre-rotate 90° around X
      // before applying the orbital quaternion — otherwise the disc is perpendicular to the orbit.
      const preRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      orbitPlaneObj.quaternion.copy(q).multiply(preRot);
      orbitPlaneObj.visible = !!(layersRef.current?.orbitPlane);
      scene.add(orbitPlaneObj);

      // Ascending node arrow (along the node line: RAAN direction in equatorial plane)
      const nodeDir = new THREE.Vector3(Math.cos(raanR), 0, Math.sin(raanR));
      const nodeLen = a * 0.8;
      ascNodeArrow = new THREE.ArrowHelper(nodeDir.clone().normalize(), new THREE.Vector3(0,0,0), nodeLen, 0x22c55e, nodeLen * 0.1, nodeLen * 0.06);
      ascNodeArrow.visible = !!(layersRef.current?.nodeVectors);
      scene.add(ascNodeArrow);

      // Descending node (opposite)
      descNodeArrow = new THREE.ArrowHelper(nodeDir.clone().negate().normalize(), new THREE.Vector3(0,0,0), nodeLen, 0xef4444, nodeLen * 0.1, nodeLen * 0.06);
      descNodeArrow.visible = !!(layersRef.current?.nodeVectors);
      scene.add(descNodeArrow);

      // Velocity arrow: placed at satellite, tangent to orbit — will be updated per frame
      velocityArrow = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(0,0,0), a * 0.25, 0xf59e0b, a * 0.04, a * 0.025);
      velocityArrow.visible = !!(layersRef.current?.velocityVector);
      scene.add(velocityArrow);
    }

    buildLayerObjects(orbitalElements);

    // Measure markers
    function buildMeasureMarkers() {
      if (measMarkerA) scene.remove(measMarkerA);
      if (measMarkerB) scene.remove(measMarkerB);
      if (measLine)    scene.remove(measLine);
      measMarkerA = measMarkerB = measLine = null;
    }
    buildMeasureMarkers();

    function updateMeasureMarkers(pts) {
      if (measMarkerA) { scene.remove(measMarkerA); measMarkerA = null; }
      if (measMarkerB) { scene.remove(measMarkerB); measMarkerB = null; }
      if (measLine)    { scene.remove(measLine);    measLine = null; }

      const r = planetR * 0.03;
      if (pts[0]) {
        const g = new THREE.SphereGeometry(r, 12, 12);
        measMarkerA = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
        measMarkerA.position.copy(pts[0]);
        scene.add(measMarkerA);
      }
      if (pts[1]) {
        const g = new THREE.SphereGeometry(r, 12, 12);
        measMarkerB = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xef4444 }));
        measMarkerB.position.copy(pts[1]);
        scene.add(measMarkerB);
      }
      if (pts[0] && pts[1]) {
        const geo = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1]]);
        measLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
        scene.add(measLine);
      }
    }

    // ── Expose setters ────────────────────────────────────────────────────────
    let _layers    = layers || {};
    let _isPlaying = true;
    let _scrubFrac = 0; // 0–1

    // Single authoritative setLayers — covers every toggleable object.
    function applyLayers(l) {
      _layers = l || {};
      if (orbitPlaneObj)       orbitPlaneObj.visible       = !!_layers.orbitPlane;
      if (velocityArrow)       velocityArrow.visible       = !!_layers.velocityVector;
      if (ascNodeArrow)        ascNodeArrow.visible        = !!_layers.nodeVectors;
      if (descNodeArrow)       descNodeArrow.visible       = !!_layers.nodeVectors;
      if (coverageMesh)        coverageMesh.visible        = !!_layers.coverageCone;
      if (groundStationMarker) groundStationMarker.visible = !!_layers.groundStation;
    }

    sceneRef.current = {
      updateOrbit: (elems) => { buildOrbit(elems); buildLayerObjects(elems); buildGroundStation(); },
      setLayers: applyLayers,
      setPlaying: (v) => { _isPlaying = v; },
      setScrubT:  (v) => { _scrubFrac = v; },
      setMeasurePts: (pts) => { updateMeasureMarkers(pts); },
      cleanup: () => {},
    };

    // ── Simple orbit controls (manual, no OrbitControls import needed) ──
    let isDragging = false, prevX = 0, prevY = 0;
    let theta = 0.4, phi = 0.9, radius = camera.position.length();

    updateCamera();

    function updateCamera() {
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(0, 0, 0);
    }

    renderer.domElement.addEventListener("mousedown", e => { isDragging = true; prevX = e.clientX; prevY = e.clientY; });
    renderer.domElement.addEventListener("mouseup",   () => isDragging = false);

    // Measurement click: raycast against a large sphere at orbit radius
    renderer.domElement.addEventListener("click", e => {
      if (toolModeRef.current === "none") return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  *  2 - 1,
        ((e.clientY - rect.top)  / rect.height) * -2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      // Intersect a sphere at SMA distance as the "orbit shell"
      const orbitR = orbitalElements.sma * scale;
      const origin = raycaster.ray.origin;
      const dir    = raycaster.ray.direction;
      // Ray-sphere intersection: |origin + t*dir|² = orbitR²
      const a = dir.dot(dir);
      const b = 2 * origin.dot(dir);
      const c = origin.dot(origin) - orbitR * orbitR;
      const disc = b*b - 4*a*c;
      if (disc < 0) return;
      const t = (-b - Math.sqrt(disc)) / (2*a);
      if (t < 0) return;
      const pt = origin.clone().addScaledVector(dir, t);
      if (onMeasurePtRef.current) onMeasurePtRef.current(pt);
    });
    renderer.domElement.addEventListener("mousemove", e => {
      if (!isDragging) return;
      const dx = (e.clientX - prevX) * 0.005;
      const dy = (e.clientY - prevY) * 0.005;
      theta -= dx;
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi + dy));
      prevX = e.clientX; prevY = e.clientY;
      updateCamera();
    });
    renderer.domElement.addEventListener("wheel", e => {
      radius = Math.max(planetR * 5, Math.min(planetR * 120, radius + e.deltaY * radius * 0.001));
      updateCamera();
    });
    // Touch support
    let lastTouchDist = 0;
    renderer.domElement.addEventListener("touchstart", e => {
      if (e.touches.length === 1) { isDragging = true; prevX = e.touches[0].clientX; prevY = e.touches[0].clientY; }
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.sqrt(dx*dx + dy*dy);
      }
    });
    renderer.domElement.addEventListener("touchend", () => isDragging = false);
    renderer.domElement.addEventListener("touchmove", e => {
      if (e.touches.length === 1 && isDragging) {
        const dx = (e.touches[0].clientX - prevX) * 0.005;
        const dy = (e.touches[0].clientY - prevY) * 0.005;
        theta -= dx; phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi + dy));
        prevX = e.touches[0].clientX; prevY = e.touches[0].clientY;
        updateCamera();
      }
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        radius = Math.max(planetR * 2.5, Math.min(planetR * 120, radius * (lastTouchDist / dist)));
        lastTouchDist = dist;
        updateCamera();
      }
    });

    // Resize
    const resizeObs = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resizeObs.observe(container);

    let coverageMesh = null;

    // Exposed to the animation loop via closure so it can offset the cone apex correctly.
    let coneHeight = 0;

    function createCoverageCone() {
      const { sma, bodyRadius } = orbitalElements;

      // Nadir half-angle η: angle from satellite nadir to the geometric horizon.
      // sin(η) = R / r  (right-angle at the tangent point on the surface).
      // The previous code used Math.acos(R/r) which gives the Earth-central angle λ,
      // NOT the satellite nadir half-angle — off by ~50° for LEO.
      const eta = getCoverageAngle(bodyRadius, sma);  // = Math.asin(R / sma)

      // Slant range: satellite → tangent-circle on surface (correct cone height)
      // Using altitude alone (sma - R) under-estimates this by ~10% for LEO.
      const slant = Math.sqrt(sma * sma - bodyRadius * bodyRadius);
      coneHeight = slant * scale;

      // Base radius of the coverage cone.
      // tan(η) · slant  =  (R / slant) · slant  =  R   — equals planet radius exactly.
      const coneRadius = bodyRadius * scale; // = planetR

      const geo = new THREE.ConeGeometry(coneRadius, coneHeight, 64, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00b4d8,
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      coverageMesh = new THREE.Mesh(geo, mat);
      scene.add(coverageMesh);
    }

    createCoverageCone();

    // ── Ground track — rendered in the 2D GroundTrackMap panel, not on the globe ──
    let groundTrackLine = null;   // kept for reference; no longer added to scene
    let groundStationMarker = null;
    let groundStationCone = null;

    function buildGroundTrack(_elems) {
      // No-op: 3D line removed. Ground track is shown in the 2D map overlay.
    }

    function buildGroundStation() {
      if (groundStationMarker) { scene.remove(groundStationMarker); groundStationMarker = null; }
      if (groundStationCone)   { scene.remove(groundStationCone);   groundStationCone   = null; }

      // Default ground station: latitude 48.85°N, longitude 2.35°E (Paris)
      const lat = 48.85 * Math.PI / 180;
      const lon = 2.35  * Math.PI / 180;
      // Surface position in body-fixed frame (lon = X-Z plane at t=0)
      const sx = planetR * Math.cos(lat) * Math.cos(lon);
      const sy = planetR * Math.sin(lat);
      const sz = planetR * Math.cos(lat) * Math.sin(lon);

      const markerGeo = new THREE.SphereGeometry(planetR * 0.028, 12, 12);
      groundStationMarker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xff4444 }));
      groundStationMarker.position.set(sx, sy, sz);
      groundStationMarker.visible = !!(layersRef.current?.groundStation);
      // Attach to planet so it rotates with it
      planet.add(groundStationMarker);
    }

    buildGroundTrack(orbitalElements);
    buildGroundStation();

    // ── Frame mode mutable state ───────────────────────────────────────────────
    let _frameMode = frameModeRef.current || "ECI";

    // ── Animation loop ────────────────────────────────────────────────────────
    let animT     = 0;
    let clockT    = 0;
    let lastFrame = performance.now();
    let animId;
    const TIMESCALE = 500;

    function animate() {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt  = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;
      animT += dt;

      const mu     = MU[orbitalElements.body] || MU.Earth;
      const period = 2 * Math.PI * Math.sqrt(Math.pow(orbitalElements.sma, 3) / mu);
      const rotRate = BODY_ROTATION_RATE[orbitalElements.body] || BODY_ROTATION_RATE.Earth;

      let physT;
      if (_isPlaying) {
        clockT += dt * TIMESCALE;
        physT = clockT;
      } else {
        physT = _scrubFrac * period;
      }

      // ── Body rotation angle at physT ──
      const bodyAngle = bodyRotAngle(orbitalElements.body, physT);

      // ── Planet mesh rotation ──
      // In ECI: planet spins (orbit is fixed in space).
      // In ECEF: planet appears fixed (orbit drifts around it).
      if (_frameMode === "ECI") {
        planet.rotation.y = bodyAngle;
      } else {
        planet.rotation.y = 0; // planet fixed; orbit rotates instead
      }

      // ── Satellite position ──
      if (satellite && orbitalElements) {
        const eciPos = getStateVector(physT, orbitalElements, scale);

        let displayPos;
        if (_frameMode === "ECI") {
          // Satellite at its true ECI position; planet rotates under it
          displayPos = eciPos;
        } else {
          // ECEF: rotate ECI position backward by body rotation angle
          const cosA = Math.cos(-bodyAngle), sinA = Math.sin(-bodyAngle);
          displayPos = new THREE.Vector3(
            eciPos.x * cosA - eciPos.z * sinA,
            eciPos.y,
            eciPos.x * sinA + eciPos.z * cosA
          );
        }

        satellite.position.copy(displayPos);
        satellite.rotation.y = animT * 2;

        // ── Layer visibility — read layersRef.current directly every frame. ────────
        // This is the only reliable approach: React updates layersRef.current
        // synchronously via useEffect([layers]), and the animation loop picks it up
        // on the very next requestAnimationFrame — no applyLayers/sceneRef.setLayers
        // call needed, no effect-timing race conditions possible.
        const lyr = layersRef.current || {};
        if (orbitPlaneObj)       orbitPlaneObj.visible       = !!lyr.orbitPlane;
        if (velocityArrow)       velocityArrow.visible       = !!lyr.velocityVector;
        if (ascNodeArrow)        ascNodeArrow.visible        = !!lyr.nodeVectors;
        if (descNodeArrow)       descNodeArrow.visible       = !!lyr.nodeVectors;
        if (coverageMesh)        coverageMesh.visible        = !!lyr.coverageCone;
        if (groundStationMarker) groundStationMarker.visible = !!lyr.groundStation;

        // Velocity arrow — update direction/position only when visible
        if (velocityArrow && velocityArrow.visible) {
          const eps = period * 0.001;
          const pF_eci = getStateVector(physT + eps, orbitalElements, scale);
          const pB_eci = getStateVector(physT - eps, orbitalElements, scale);

          let tangent;
          if (_frameMode === "ECI") {
            tangent = pF_eci.clone().sub(pB_eci).normalize();
          } else {
            // Transform both endpoints to ECEF then diff
            const ecefF = new THREE.Vector3(
              pF_eci.x * Math.cos(-bodyAngle) - pF_eci.z * Math.sin(-bodyAngle),
              pF_eci.y,
              pF_eci.x * Math.sin(-bodyAngle) + pF_eci.z * Math.cos(-bodyAngle)
            );
            const ecefB = new THREE.Vector3(
              pB_eci.x * Math.cos(-bodyAngle) - pB_eci.z * Math.sin(-bodyAngle),
              pB_eci.y,
              pB_eci.x * Math.sin(-bodyAngle) + pB_eci.z * Math.cos(-bodyAngle)
            );
            tangent = ecefF.clone().sub(ecefB).normalize();
          }
          const arrowLen = orbitalElements.sma * scale * 0.22;
          velocityArrow.setDirection(tangent);
          velocityArrow.setLength(arrowLen, arrowLen * 0.16, arrowLen * 0.1);
          velocityArrow.position.copy(displayPos);
        }

        // Orbit plane + node vectors — rotate with frame in ECEF mode
        const frameRot = _frameMode === "ECEF" ? -bodyAngle : 0;
        if (orbitPlaneObj) orbitPlaneObj.rotation.y = frameRot;
        if (ascNodeArrow)  ascNodeArrow.rotation.y  = frameRot;
        if (descNodeArrow) descNodeArrow.rotation.y = frameRot;

        // Coverage cone
        if (coverageMesh) {
          const outward = displayPos.clone().normalize();
          coverageMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), outward);
          coverageMesh.position.copy(displayPos.clone().sub(outward.clone().multiplyScalar(coneHeight / 2)));
        }
      }

      renderer.render(scene, camera);
    }
    animate();

    sceneRef.current.setFrameMode = (m) => { _frameMode = m; };
    sceneRef.current.cleanup = () => {
      cancelAnimationFrame(animId);
      resizeObs.disconnect();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };

    // Apply whatever layer state was set while Three.js was loading
    applyLayers(layersRef.current);
  }

  if (!orbitalElements) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: T.textDim, fontFamily: T.mono, fontSize: 12,
      }}>
        No orbital data — mission not yet generated or orbit type not supported
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Orbital element summary bar */}
      <div style={{
        display: "flex", gap: 0, borderBottom: `1px solid ${T.border}`,
        background: T.surface, flexShrink: 0,
      }}>
        {[
          { label: "Body",  value: orbitalElements.body },
          { label: "SMA",   value: `${orbitalElements.sma.toLocaleString()} km` },
          { label: "Ecc",   value: orbitalElements.ecc.toFixed(4) },
          { label: "Inc",   value: `${orbitalElements.inc.toFixed(2)}°` },
          { label: "RAAN",  value: `${orbitalElements.raan.toFixed(1)}°` },
          { label: "AoP",   value: `${orbitalElements.aop.toFixed(1)}°` },
          { label: "Alt",   value: `${(orbitalElements.sma - orbitalElements.bodyRadius).toLocaleString()} km` },
        ].map(({ label, value }) => (
          <div key={label} style={{
            padding: "10px 16px", borderRight: `1px solid ${T.border}`,
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            <div style={{ fontSize: 9, color: T.textDim, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: T.sans }}>{label}</div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.accent }}>{value}</div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ padding: "10px 16px", display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, borderLeft: `1px solid ${T.border}`, paddingLeft: 16 }}>
            🖱 Drag · Scroll to zoom
          </div>
        </div>
      </div>

      {/* 3D canvas + overlays */}
      <div style={{ flex: 1, position: "relative", minHeight: 400 }}>
        <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

        {/* ── Top-right HUD: Link Budget + Velocity ── */}
        <OrbitalHUD orbitalElements={orbitalElements} scrubT={scrubT} isPlaying={isPlaying} frameMode={frameMode} />

        {/* ── Bottom-right: 2D Ground Track Map ── */}
        <GroundTrackMap orbitalElements={orbitalElements} layers={layers} />
      </div>
    </div>
  );
}

// ─── Ground Track Map (2D equirectangular popup) ──────────────────────────────

function computeGroundTrackLatLon(orbitalElements, N = 6) {
  const { sma, ecc, inc, raan, aop, body } = orbitalElements;
  const mu = MU[body] || MU.Earth;
  const rotRate = BODY_ROTATION_RATE[body] || BODY_ROTATION_RATE.Earth;
  const period = 2 * Math.PI * Math.sqrt(Math.pow(sma, 3) / mu);
  const steps = 720 * N;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * period * N;
    const n_motion = Math.sqrt(mu / Math.pow(sma, 3));
    const M = (n_motion * t) % (2 * Math.PI);
    let E = M;
    for (let k = 0; k < 10; k++) E = E - (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
    const nu = 2 * Math.atan2(Math.sqrt(1 + ecc) * Math.sin(E / 2), Math.sqrt(1 - ecc) * Math.cos(E / 2));
    const r = sma * (1 - ecc * Math.cos(E));
    const incR = inc * Math.PI / 180, raanR = raan * Math.PI / 180, aopR = aop * Math.PI / 180;
    const xP = r * Math.cos(nu), zP = r * Math.sin(nu);
    // Perifocal → ECI (standard rotation matrix)
    const cosR = Math.cos(raanR), sinR = Math.sin(raanR);
    const cosI = Math.cos(incR),  sinI = Math.sin(incR);
    const cosW = Math.cos(aopR),  sinW = Math.sin(aopR);
    const eciX = (cosR*cosW - sinR*sinW*cosI)*xP + (-cosR*sinW - sinR*cosW*cosI)*zP;
    const eciY = (sinI*sinW)*xP + (sinI*cosW)*zP;
    const eciZ = (sinR*cosW + cosR*sinW*cosI)*xP + (-sinR*sinW + cosR*cosW*cosI)*zP;
    // ECI → ECEF
    const th = rotRate * t;
    const ex = eciX*Math.cos(-th) - eciZ*Math.sin(-th);
    const ey = eciY;
    const ez = eciX*Math.sin(-th) + eciZ*Math.cos(-th);
    pts.push({
      lat: Math.atan2(ey, Math.sqrt(ex*ex + ez*ez)) * 180 / Math.PI,
      lon: Math.atan2(ez, ex) * 180 / Math.PI,
    });
  }
  return pts;
}

function GroundTrackMap({ orbitalElements, layers }) {
  const [collapsed, setCollapsed] = useState(false);
  const canvasRef = useRef(null);
  const GS = { lat: 48.85, lon: 2.35, label: "Paris GS" };

  useEffect(() => {
    if (collapsed || !canvasRef.current || !orbitalElements) return;
    const pts = computeGroundTrackLatLon(orbitalElements);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#04080f";
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "#152236"; ctx.lineWidth = 0.5;
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = ((lon + 180) / 360) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let lat = -90; lat <= 90; lat += 30) {
      const y = ((90 - lat) / 180) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // Equator highlight
    ctx.strokeStyle = "#1e3a5f"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

    // Labels
    ctx.fillStyle = "#4d6880"; ctx.font = "9px 'Courier New'";
    ctx.textAlign = "center";
    for (let lon = -150; lon <= 150; lon += 60)
      ctx.fillText(`${lon}°`, ((lon+180)/360)*W, H - 3);
    ctx.textAlign = "right";
    for (let lat = -60; lat <= 60; lat += 30) {
      if (lat === 0) continue;
      ctx.fillText(`${lat}°`, 22, ((90-lat)/180)*H + 3);
    }

    // Track segments — split on anti-meridian crossings
    const N_ORBITS = 6;
    const segSize = Math.floor(pts.length / N_ORBITS);
    const segments = [[]];
    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && Math.abs(pts[i].lon - pts[i-1].lon) > 180) segments.push([]);
      segments[segments.length - 1].push(pts[i]);
    }
    segments.forEach((seg) => {
      if (seg.length < 2) return;
      // Fade older orbits by approximate time position
      const midIdx = Math.floor(pts.indexOf(seg[0]) / pts.length * N_ORBITS);
      const alpha = Math.max(0.2, 1 - midIdx * 0.13);
      ctx.strokeStyle = `rgba(0,180,216,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      seg.forEach((p, i) => {
        const x = ((p.lon+180)/360)*W, y = ((90-p.lat)/180)*H;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // Direction arrows
    ctx.fillStyle = "#00b4d8";
    for (let i = 40; i < pts.length - 1; i += 80) {
      if (Math.abs(pts[i].lon - pts[i+1].lon) > 180) continue;
      const x1 = ((pts[i].lon+180)/360)*W,   y1 = ((90-pts[i].lat)/180)*H;
      const x2 = ((pts[i+1].lon+180)/360)*W, y2 = ((90-pts[i+1].lat)/180)*H;
      const angle = Math.atan2(y2-y1, x2-x1);
      ctx.save(); ctx.translate(x1, y1); ctx.rotate(angle);
      ctx.beginPath(); ctx.moveTo(4,0); ctx.lineTo(-3,-2.5); ctx.lineTo(-3,2.5);
      ctx.closePath(); ctx.fill(); ctx.restore();
    }

    // Ground station
    if (layers?.groundStation) {
      const gx = ((GS.lon+180)/360)*W, gy = ((90-GS.lat)/180)*H;
      ctx.beginPath(); ctx.arc(gx, gy, 5, 0, Math.PI*2);
      ctx.fillStyle = "#ef4444"; ctx.fill();
      ctx.strokeStyle = "#ff8888"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#ef4444"; ctx.font = "bold 9px 'Courier New'";
      ctx.textAlign = "left"; ctx.fillText(GS.label, gx+7, gy+3);
    }

    // Sub-satellite point at t=0
    const sp = pts[0];
    ctx.beginPath();
    ctx.arc(((sp.lon+180)/360)*W, ((90-sp.lat)/180)*H, 4, 0, Math.PI*2);
    ctx.fillStyle = "#ffd700"; ctx.fill();

  }, [orbitalElements, collapsed, layers?.groundStation]);

  if (!orbitalElements || !layers?.groundTrack) return null;

  return (
    <div style={{
      position: "absolute", bottom: 16, right: 16, zIndex: 20,
      background: "rgba(8,15,28,0.93)", border: `1px solid ${T.borderHi}`,
      borderRadius: 8, overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
      width: collapsed ? "auto" : 420,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "7px 12px",
        borderBottom: collapsed ? "none" : `1px solid ${T.border}`,
        cursor: "pointer", userSelect: "none",
      }} onClick={() => setCollapsed(v => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 11 }}>〰</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
            textTransform: "uppercase", color: T.accent, fontFamily: T.sans }}>
            Ground Track
          </span>
          <span style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono }}>6 orbits</span>
        </div>
        <span style={{ fontSize: 12, color: T.textDim, marginLeft: 12 }}>
          {collapsed ? "▲" : "▼"}
        </span>
      </div>
      {!collapsed && (
        <canvas ref={canvasRef} width={420} height={210} style={{ display: "block" }} />
      )}
    </div>
  );
}

// ─── Orbital HUD (top-right corner telemetry panel) ───────────────────────────

function OrbitalHUD({ orbitalElements, scrubT, isPlaying, frameMode }) {
  const [tick, setTick] = useState(0);
  const clockRef = useRef(0);
  const lastRef  = useRef(performance.now());

  useEffect(() => {
    let id;
    function loop() {
      id = requestAnimationFrame(loop);
      const now = performance.now();
      const dt  = Math.min((now - lastRef.current) / 1000, 0.1);
      lastRef.current = now;
      if (isPlaying) clockRef.current += dt * 500;
      setTick(t => t + 1);
    }
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [isPlaying]);

  if (!orbitalElements) return null;

  const { sma, ecc, inc, body, bodyRadius, raan, aop } = orbitalElements;
  const mu = MU[body] || MU.Earth;

  const period  = 2 * Math.PI * Math.sqrt(Math.pow(sma, 3) / mu);
  const physT   = isPlaying ? clockRef.current : scrubT * period;

  // Kepler
  const n = Math.sqrt(mu / Math.pow(sma, 3));
  const M = (n * physT) % (2 * Math.PI);
  let E = M;
  for (let i = 0; i < 10; i++) { const dE = (E - ecc*Math.sin(E) - M) / (1 - ecc*Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-9) break; }
  const nu     = 2 * Math.atan2(Math.sqrt(1+ecc)*Math.sin(E/2), Math.sqrt(1-ecc)*Math.cos(E/2));
  const r_km   = sma * (1 - ecc*Math.cos(E));
  const alt_km = r_km - bodyRadius;

  // ECI position (unit: km)
  const incR = inc * Math.PI/180, raanR = raan * Math.PI/180, aopR = aop * Math.PI/180;
  const nuRad = nu;
  const xP = r_km * Math.cos(nuRad), zP = r_km * Math.sin(nuRad);
  // Rotate perifocal → ECI
  const cosR = Math.cos(raanR), sinR = Math.sin(raanR);
  const cosI = Math.cos(incR),  sinI = Math.sin(incR);
  const cosW = Math.cos(aopR),  sinW = Math.sin(aopR);
  const eci_x = (cosR*cosW - sinR*sinW*cosI)*xP + (-cosR*sinW - sinR*cosW*cosI)*zP;
  const eci_y = (sinI*sinW)*xP + (sinI*cosW)*zP;
  const eci_z = (sinR*cosW + cosR*sinW*cosI)*xP + (-sinR*sinW + cosR*cosW*cosI)*zP;

  // ECEF: rotate by body rotation angle
  const bodyAngle = bodyRotAngle(body, physT);
  const cosA = Math.cos(-bodyAngle), sinA = Math.sin(-bodyAngle);
  const ecef_x = eci_x * cosA - eci_z * sinA;
  const ecef_y = eci_y;
  const ecef_z = eci_x * sinA + eci_z * cosA;

  // Sub-satellite point (geodetic, spherical)
  const lat_deg = Math.atan2(ecef_y, Math.sqrt(ecef_x*ecef_x + ecef_z*ecef_z)) * 180/Math.PI;
  const lon_raw = Math.atan2(ecef_z, ecef_x) * 180/Math.PI;
  const lon_deg = ((lon_raw + 180) % 360) - 180;

  // Velocity
  const v_kms   = Math.sqrt(mu * (2/r_km - 1/sma));
  const v_circ  = Math.sqrt(mu / r_km);
  const vr_kms  = Math.sqrt(mu/sma) * ecc*Math.sin(E) / (1 - ecc*Math.cos(E));
  const vt_kms  = Math.sqrt(Math.max(0, v_kms*v_kms - vr_kms*vr_kms));
  const gamma_deg = Math.atan2(vr_kms, vt_kms) * 180/Math.PI;
  const nu_deg    = ((nu * 180/Math.PI) + 360) % 360;
  const orbitFrac = (physT % period) / period;

  // Link budget
  const freqGHz = 8.0, lambda_m = 0.3 / freqGHz;
  const slant_km = alt_km;
  const FSPL_dB  = 20*Math.log10(4*Math.PI*slant_km*1000/lambda_m);
  const Pt_dBm = 30, Gt_dBi = 10, Gr_dBi = 40, Tsys_dBK = 23, k_dBm = -228.6+30, Rb_dBHz = 60;
  const CN0  = Pt_dBm + Gt_dBi + Gr_dBi - FSPL_dB - k_dBm - Tsys_dBK;
  const Eb_N0 = CN0 - Rb_dBHz;

  const isECEF = frameMode === "ECEF";

  const rows = [
    { label: "Frame",         value: frameMode,                              color: isECEF ? T.amber : T.accent },
    { label: "True Anomaly",  value: `${nu_deg.toFixed(2)}°`,               color: T.accent },
    { label: "Altitude",      value: `${alt_km.toFixed(1)} km`,              color: T.accent },
    { label: "Orbit Frac.",   value: `${(orbitFrac*100).toFixed(1)}%`,       color: T.accent },
    { label: "── Position", value: "",                                       color: T.textDim, section: true },
    { label: "Lat (SSP)",     value: `${lat_deg.toFixed(3)}°`,               color: isECEF ? T.textBright : T.textDim },
    { label: "Lon (SSP)",     value: `${lon_deg.toFixed(3)}°`,               color: isECEF ? T.textBright : T.textDim },
    { label: "── Velocity",  value: "",                                      color: T.textDim, section: true },
    { label: "|v| total",     value: `${v_kms.toFixed(3)} km/s`,             color: T.amber },
    { label: "v radial",      value: `${vr_kms.toFixed(3)} km/s`,            color: T.amber },
    { label: "v tangential",  value: `${vt_kms.toFixed(3)} km/s`,            color: T.amber },
    { label: "v circular",    value: `${v_circ.toFixed(3)} km/s`,            color: T.amber },
    { label: "Flight path γ", value: `${gamma_deg.toFixed(2)}°`,             color: T.amber },
    { label: "── Link Budget", value: "",                                    color: T.textDim, section: true },
    { label: "Slant range",   value: `${slant_km.toFixed(0)} km`,            color: T.green },
    { label: "FSPL",          value: `${FSPL_dB.toFixed(1)} dB`,             color: T.green },
    { label: "C/N₀",          value: `${CN0.toFixed(1)} dB-Hz`,              color: Eb_N0 > 10 ? T.green : T.red },
    { label: "Eb/N₀",         value: `${Eb_N0.toFixed(1)} dB`,               color: Eb_N0 > 6  ? T.green : T.red },
  ];

  return (
    <div style={{
      position: "absolute", top: 12, right: 12,
      background: `${T.panel}dd`, backdropFilter: "blur(8px)",
      border: `1px solid ${isECEF ? T.amber+"88" : T.borderHi}`, borderRadius: 8,
      padding: "12px 14px", minWidth: 230, zIndex: 20,
      fontFamily: T.mono,
    }}>
      <div style={{ fontSize: 8, letterSpacing: "0.2em", textTransform: "uppercase", color: isECEF ? T.amber : T.accent, marginBottom: 10, fontFamily: T.sans }}>
        ◈ Telemetry / Link Budget
      </div>
      {rows.map((r, i) =>
        r.section ? (
          <div key={i} style={{ fontSize: 9, color: T.textDim, marginTop: 8, marginBottom: 4, letterSpacing: "0.12em" }}>{r.label}</div>
        ) : (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: T.textDim }}>{r.label}</span>
            <span style={{ fontSize: 10, color: r.color, fontWeight: 600 }}>{r.value}</span>
          </div>
        )
      )}
      <div style={{ marginTop: 8, fontSize: 9, color: T.textDim, borderTop: `1px solid ${T.border}`, paddingTop: 6 }}>
        X-band · 1 W · Nadir pass model
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// ECSS-E-10-05A PANEL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

const T_PURPLE = "#a78bfa";
const PHASE_COLORS = { "Phase 0": "#6366f1", "Phase A": "#0ea5e9", "Phase B": "#22c55e", "Phase C": "#f59e0b" };

// §3.1.2 / §4.5.3e / §4.7.6 — Validation panel
function EcssValidationPanel({ ecssValidation }) {
  if (!ecssValidation) return <div style={{ color: T.textDim, fontSize: 12 }}>Generate a mission to run checks.</div>;
  const { decomposition_errors = [], naming_errors = [], traceability_errors = [] } = ecssValidation;
  const total = decomposition_errors.length + naming_errors.length + traceability_errors.length;
  if (total === 0) {
    return (
      <div style={{ background: `${T.green}12`, border: `1px solid ${T.green}40`, borderRadius: 4, padding: "8px 10px", fontSize: 11, color: T.green, fontFamily: T.mono }}>
        ✓ All ECSS-E-10-05A checks passed
      </div>
    );
  }
  const sections = [
    { label: "§4.5.3e Decomposition", items: decomposition_errors, color: T.red },
    { label: "§3.1.2 Naming",         items: naming_errors,        color: T.amber },
    { label: "§4.7.6 Traceability",   items: traceability_errors,  color: T.amber },
  ];
  return (
    <div>
      {sections.map(({ label, items, color }) => items.length === 0 ? null : (
        <div key={label} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 5 }}>{label} ({items.length})</div>
          {items.map((err, i) => (
            <div key={i} style={{ background: `${color}0e`, border: `1px solid ${color}33`, borderRadius: 4, padding: "6px 9px", fontSize: 10, color, marginBottom: 5, fontFamily: T.mono, lineHeight: 1.5 }}>
              {err}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// §4.8.1 — Critical functions (FMECA candidates)
function CriticalFunctionsPanel({ criticalFunctions }) {
  if (!criticalFunctions || criticalFunctions.length === 0)
    return <div style={{ color: T.textDim, fontSize: 12 }}>No critical functions flagged.</div>;
  return (
    <div>
      <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, lineHeight: 1.6, marginBottom: 10, padding: "6px 8px", background: `${T.red}0a`, border: `1px solid ${T.red}20`, borderRadius: 4 }}>
        ECSS §4.8.1 — functions involving fault tolerance, safety, or critical resources
      </div>
      {criticalFunctions.map((fn, i) => (
        <div key={i} style={{ background: T.surface, border: `1px solid ${T.red}33`, borderRadius: 4, padding: "8px 10px", marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: T.red, fontWeight: 700, marginBottom: 3 }}>⚡ {fn.name}</div>
          <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, lineHeight: 1.5 }}>{fn.reason}</div>
        </div>
      ))}
    </div>
  );
}

// §4.6.3 — Functional matrix
function FunctionalMatrixPanel({ matrix }) {
  if (!matrix || !matrix.rows || matrix.rows.length === 0)
    return <div style={{ color: T.textDim, fontSize: 12 }}>Not available.</div>;
  const groups = {};
  matrix.rows.forEach(row => { if (!groups[row.level1_name]) groups[row.level1_name] = []; groups[row.level1_name].push(row); });
  return (
    <div>
      <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, lineHeight: 1.6, marginBottom: 10, padding: "6px 8px", background: `${T.accent}0a`, border: `1px solid ${T.accent}20`, borderRadius: 4 }}>
        ECSS §4.6.3 — level-2 functions mapped to parent and satisfied requirement
      </div>
      {Object.entries(groups).map(([l1name, rows]) => (
        <div key={l1name} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, marginBottom: 6, fontFamily: T.mono }}>▸ {l1name}</div>
          {rows.map((row, i) => (
            <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "7px 9px", marginBottom: 5 }}>
              <div style={{ fontSize: 10, color: T.textBright, marginBottom: 3 }}>{row.level2_name}</div>
              <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, lineHeight: 1.5 }}>
                {row.requirement && row.requirement !== "—"
                  ? (row.requirement.length > 80 ? row.requirement.slice(0, 77) + "…" : row.requirement)
                  : <span style={{ color: T.red }}>⚠ No requirement</span>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// §4.5.3i — Inferred functional interfaces
function InterfacesPanel({ interfaces }) {
  if (!interfaces || interfaces.length === 0)
    return <div style={{ color: T.textDim, fontSize: 12 }}>No inferred interfaces.</div>;
  return (
    <div>
      <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, lineHeight: 1.6, marginBottom: 10, padding: "6px 8px", background: `${T_PURPLE}0a`, border: `1px solid ${T_PURPLE}20`, borderRadius: 4 }}>
        ECSS §4.5.3i — inferred data/control interfaces between functions
      </div>
      {interfaces.map((iface, i) => (
        <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "8px 10px", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, marginBottom: 4 }}>
            <span style={{ color: T.textBright }}>{iface.from_name}</span>
            <span style={{ color: T_PURPLE }}>→</span>
            <span style={{ color: T.textBright }}>{iface.to_name}</span>
          </div>
          <div style={{ display: "inline-block", background: `${T_PURPLE}18`, border: `1px solid ${T_PURPLE}44`, borderRadius: 3, padding: "2px 7px", fontSize: 9, color: T_PURPLE, fontFamily: T.mono }}>
            {iface.resource}
          </div>
        </div>
      ))}
    </div>
  );
}

// §5.2 — Phase annotation
function PhaseMapPanel({ phaseMap }) {
  if (!phaseMap || phaseMap.length === 0)
    return <div style={{ color: T.textDim, fontSize: 12 }}>Not available.</div>;
  const byPhase = {};
  phaseMap.forEach(e => { if (!byPhase[e.phase]) byPhase[e.phase] = []; byPhase[e.phase].push(e); });
  return (
    <div>
      <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, lineHeight: 1.6, marginBottom: 10, padding: "6px 8px", background: `${T.amber}0a`, border: `1px solid ${T.amber}20`, borderRadius: 4 }}>
        ECSS §5.2 — functions annotated by relevant project phase
      </div>
      {["Phase 0", "Phase A", "Phase B", "Phase C"].map(phase => {
        const entries = byPhase[phase];
        if (!entries) return null;
        const col = PHASE_COLORS[phase];
        return (
          <div key={phase} style={{ marginBottom: 12 }}>
            <div style={{ display: "inline-block", background: `${col}18`, border: `1px solid ${col}44`, borderRadius: 3, padding: "2px 8px", fontSize: 9, color: col, fontFamily: T.mono, fontWeight: 700, marginBottom: 6 }}>{phase}</div>
            {entries.map((e, i) => (
              <div key={i} style={{ fontSize: 10, color: T.textDim, padding: "3px 0", borderBottom: `1px solid ${T.border}` }}>{e.name}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  // View state
  const [view, setView]         = useState("form");
  const [graphTab, setGraphTab] = useState("graph");
  const [step, setStep]         = useState(0);
  const [loading, setLoading]   = useState(false);

  // Mission form
  const [form, setForm] = useState({
    name: "", orbit: "LEO",
    objectives:  [""],
    constraints: { mass: "", power: "", lifetime: "" },
    payload:     { type: "", resolution: "" },
    orbitalElements: { sma: "", ecc: "", inc: "", raan: "", aop: "" },
  });

  // Resolved orbital elements (after generation)
  const [resolvedOrbit, setResolvedOrbit] = useState(null);

  // ── Orbit viewer controls ──────────────────────────────────────────────────
  const [layers, setLayers]   = useState({ orbitPlane: false, velocityVector: true, nodeVectors: false, groundTrack: true, groundStation: false });
  const [toolMode, setToolMode] = useState("none");  // "none" | "distance" | "angle"
  const [isPlaying, setIsPlaying] = useState(true);
  const [scrubT, setScrubT]   = useState(0); // 0–1 fraction of orbital period
  const [measurePts, setMeasurePts] = useState([]); // up to 2 THREE.Vector3 points
  const [measureResult, setMeasureResult] = useState(null); // { type, value }
  const [frameMode, setFrameMode] = useState("ECI"); // "ECI" | "ECEF"
  const [retrograde, setRetrograde] = useState(false); // reverse orbit direction

  const toggleLayer = (k) => setLayers(l => ({ ...l, [k]: !l[k] }));

  // Graph state
  const [nodes, setNodes]   = useState([]);
  const [edges, setEdges]   = useState([]);
  const [rawGraph, setRawGraph]       = useState(null);
  const [insights, setInsights]       = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [traceMode, setTraceMode]       = useState("none");

  // Persistence
  const [savedMissions, setSavedMissions]   = useState([]);
  const [showMissions, setShowMissions]     = useState(false);
  const [currentMissionId, setCurrentMissionId] = useState(null);

  // ── New ECSS state (ECSS-E-10-05A) ────────────────────────────────────────
  const [ecssValidation, setEcssValidation]       = useState(null);
  const [criticalFunctions, setCriticalFunctions] = useState([]);
  const [functionalMatrix, setFunctionalMatrix]   = useState(null);
  const [interfaces, setInterfaces]               = useState([]);
  const [phaseMap, setPhaseMap]                   = useState([]);
  const [ecssOpen, setEcssOpen] = useState({
    validation: false, critical: false,
    matrix: false, interfaces: false, phases: false,
  });
  const toggleEcss = (key) => setEcssOpen(s => ({ ...s, [key]: !s[key] }));

  const onNodesChange = useCallback((changes) => {
    setNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes) => {
    const removedIds = new Set(
      changes.filter(c => c.type === "remove").map(c => c.id)
    );
    if (removedIds.size > 0) {
      setRawGraph(prev => prev
        ? { ...prev, edges: prev.edges.filter(e => !removedIds.has(e.id)) }
        : prev
      );
    }
    setEdges(eds => applyEdgeChanges(changes, eds));
  }, []);

  const fetchSaved = async () => {
    try { setSavedMissions(await listMissions()); } catch {}
  };

  // ─── Form helpers ──────────────────────────────────────────────────────────
  const upForm  = (k, v)    => setForm(f => ({ ...f, [k]: v }));
  const upConst = (k, v)    => setForm(f => ({ ...f, constraints: { ...f.constraints, [k]: v } }));
  const upPay   = (k, v)    => setForm(f => ({ ...f, payload:     { ...f.payload,     [k]: v } }));
  const upOE    = (k, v)    => setForm(f => ({ ...f, orbitalElements: { ...f.orbitalElements, [k]: v } }));
  const addObj  = ()        => setForm(f => ({ ...f, objectives: [...f.objectives, ""] }));
  const rmObj   = i         => setForm(f => ({ ...f, objectives: f.objectives.filter((_, j) => j !== i) }));
  const upObj   = (i, val)  => setForm(f => ({ ...f, objectives: f.objectives.map((o, j) => j === i ? val : o) }));

  const missionPayload = () => {
    const base = {
      name:        form.name,
      orbit:       form.orbit,
      objectives:  form.objectives.filter(Boolean),
      constraints: Object.values(form.constraints).some(Boolean) ? form.constraints : undefined,
      payload:     (form.payload.type || form.payload.resolution) ? form.payload : undefined,
    };

    if (isOrbitalMission(form.orbit)) {
      base.orbital_elements = resolveOrbitalElements(form.orbit, form.orbitalElements);
    }

    return base;
  };

  // ─── Generate ──────────────────────────────────────────────────────────────
  const runGenerate = async () => {
    setLoading(true);
    try {
      // Resolve and store orbital elements before sending
      if (isOrbitalMission(form.orbit)) {
        const resolved = resolveOrbitalElements(form.orbit, form.orbitalElements);
        setResolvedOrbit(resolved);
      } else {
        setResolvedOrbit(null);
      }

      const data = await generateSystem(missionPayload());
      applyGraphData(data);
      setCurrentMissionId(data.id);
      setView("graph");
      setGraphTab("graph");
      fetchSaved();
    } catch (err) {
      console.error(err);
      alert("Generation failed — make sure the backend is running on port 8000.");
    }
    setLoading(false);
  };

  const applyGraphData = (data) => {
    setRawGraph(data.graph);
    setInsights(data.insights    || []);
    setSuggestions(data.suggestions || []);
    const flow = convertToFlow(data.graph);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    // ── ECSS fields (ECSS-E-10-05A) ────────────────────────────────────────
    setEcssValidation(data.ecss_validation    || null);
    setCriticalFunctions(data.critical_functions || []);
    setFunctionalMatrix(data.functional_matrix   || null);
    setInterfaces(data.interfaces               || []);
    setPhaseMap(data.phase_map                  || []);
  };
  // ─── Graph interactions ────────────────────────────────────────────────────
  const onNodeClick = useCallback((_, node) => {
    setSelectedNode(node);
    if (!rawGraph) return;

    const connected = new Set([node.id]);
    if (traceMode === "upstream")   getUpstream(rawGraph, node.id).forEach(n => connected.add(n));
    if (traceMode === "downstream") getDownstream(rawGraph, node.id).forEach(n => connected.add(n));

    setNodes(nds => nds.map(n => ({ ...n, style: { ...n.style, opacity: connected.has(n.id) ? 1 : 0.08 } })));
    setEdges(eds => eds.map(e => ({ ...e, style: { ...e.style, opacity: connected.has(e.source) && connected.has(e.target) ? 1 : 0.04 } })));
  }, [rawGraph, traceMode]);

  const resetView = useCallback(() => {
    if (!rawGraph) return;
    const flow = convertToFlow(rawGraph);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelectedNode(null);
  }, [rawGraph]);

  const handleApply = async (s) => {
    try {
      const res = await applySuggestion(rawGraph, s);
      setRawGraph(res.graph);
      const flow = convertToFlow(res.graph);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setSuggestions(prev => prev.filter(x => x !== s));
    } catch (e) { console.error(e); }
  };

  const handleLoad = async (id) => {
    try {
      const data = await loadMission(id);
      if (!data.graph) return;
      applyGraphData(data);
      setCurrentMissionId(id);

      if (isOrbitalMission(data.orbit)) {
        const resolved = resolveOrbitalElements(
          data.orbit,
          data.orbital_elements || {}
        );
        setResolvedOrbit(resolved);
      } else {
        setResolvedOrbit(null);
      }
      
      setView("graph");
      setGraphTab("graph");
      setShowMissions(false);
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    try {
      await deleteMission(id);
      setSavedMissions(prev => prev.filter(m => m.id !== id));
      if (currentMissionId === id) setCurrentMissionId(null);
    } catch (e) { console.error(e); }
  };

  const updateNodeLabel = (newLabel) => {
    if (!selectedNode) return;
    const g = { ...rawGraph, nodes: rawGraph.nodes.map(n => n.id === selectedNode.id ? { ...n, label: newLabel } : n) };
    setRawGraph(g);
    const flow = convertToFlow(g);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  };

  useEffect(() => {
    listMissions().then(setSavedMissions).catch(console.error);
  }, []);
  
  // ─── FORM VIEW ─────────────────────────────────────────────────────────────
  if (view === "form") {
    const isOrbital = isOrbitalMission(form.orbit);
    const STEPS = isOrbital
      ? ["Identity", "Objectives", "Orbital Elements", "Parameters"]
      : ["Identity", "Objectives", "Parameters"];

    const canNext = () => {
      if (step === 0) return form.name.trim().length > 0 && form.orbit.trim().length > 0;
      if (step === 1) return form.objectives.some(o => o.trim().length > 0);
      return true;
    };

    const isLastStep = step === STEPS.length - 1;

    return (
      <div style={{
        minHeight: "100vh", background: T.bg, fontFamily: T.sans,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}>
        {/* Subtle grid background */}
        <div style={{
          position: "fixed", inset: 0, pointerEvents: "none",
          backgroundImage: `linear-gradient(${T.border} 1px, transparent 1px),
                            linear-gradient(90deg, ${T.border} 1px, transparent 1px)`,
          backgroundSize: "48px 48px", opacity: 0.35,
        }} />

        <div style={{ width: "100%", maxWidth: 640, position: "relative", zIndex: 1 }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <div style={{
              display: "inline-block",
              fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase",
              color: T.accent, fontFamily: T.mono, marginBottom: 12,
              padding: "4px 12px", border: `1px solid ${T.accentDark}`,
              borderRadius: 3,
            }}>
              ◈ Functional Analysis Tool
            </div>
            <h1 style={{
              fontSize: 34, fontWeight: 800, color: T.textBright,
              margin: "10px 0 0", letterSpacing: "-0.03em",
            }}>
              Mission Architect
            </h1>
            <p style={{ color: T.textDim, fontSize: 13, marginTop: 8 }}>
              AI-powered functional breakdown & requirements generation — for any space mission
            </p>
          </div>

          {/* Step indicator */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 32, gap: 0 }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 800,
                    background: i < step ? T.green : i === step ? T.accent : "transparent",
                    border: `2px solid ${i < step ? T.green : i === step ? T.accent : T.border}`,
                    color: i <= step ? T.bg : T.textDim,
                    transition: "all 0.3s",
                  }}>
                    {i < step ? "✓" : i + 1}
                  </div>
                  <span style={{
                    fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: i === step ? T.textBright : T.textDim,
                    fontWeight: i === step ? 700 : 400,
                    whiteSpace: "nowrap",
                  }}>
                    {s}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{
                    width: 60, height: 1, margin: "0 8px",
                    background: i < step ? T.green : T.border,
                    marginBottom: 22, transition: "background 0.3s",
                  }} />
                )}
              </div>
            ))}
          </div>

          {/* Form card */}
          <div style={{
            background: T.panel, border: `1px solid ${T.border}`,
            borderRadius: 10, padding: 28,
          }}>

            {/* Step 0 — Identity */}
            {step === 0 && (
              <div>
                <div style={{ marginBottom: 22 }}>
                  <Label>Mission Name</Label>
                  <Input
                    value={form.name}
                    onChange={e => upForm("name", e.target.value)}
                    placeholder="e.g. Arctic Climate Monitor, Lunar Scout Alpha, Mars Relay"
                  />
                </div>
                <div>
                  <Label>Orbit / Destination</Label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                    {ORBIT_OPTS.map(o => (
                      <button
                        key={o}
                        onClick={() => upForm("orbit", o)}
                        style={{
                          background: form.orbit === o ? `${T.accent}22` : "transparent",
                          border: `1px solid ${form.orbit === o ? T.accent : T.border}`,
                          borderRadius: 4, color: form.orbit === o ? T.accent : T.textDim,
                          padding: "6px 12px", cursor: "pointer", fontSize: 12,
                          fontFamily: T.mono, transition: "all 0.15s",
                        }}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                  <Input
                    value={ORBIT_OPTS.includes(form.orbit) ? "" : form.orbit}
                    onChange={e => upForm("orbit", e.target.value)}
                    placeholder="Or type a custom destination…"
                  />
                </div>
              </div>
            )}

            {/* Step 1 — Objectives */}
            {step === 1 && (
              <div>
                <Label>Mission Objectives</Label>
                {form.objectives.map((obj, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <Input
                      value={obj}
                      onChange={e => upObj(i, e.target.value)}
                      placeholder={`Objective ${i + 1} — e.g. Monitor sea ice extent`}
                    />
                    {form.objectives.length > 1 && (
                      <button
                        onClick={() => rmObj(i)}
                        style={{
                          background: "transparent", border: `1px solid ${T.border}`,
                          borderRadius: 5, color: T.red, cursor: "pointer",
                          padding: "0 10px", fontSize: 16, flexShrink: 0,
                        }}
                      >×</button>
                    )}
                  </div>
                ))}
                <Btn onClick={addObj} variant="ghost" style={{ fontSize: 11, marginTop: 4 }}>
                  + Add Objective
                </Btn>
              </div>
            )}

            {/* Step 2 — Orbital Elements (only if orbital mission) */}
            {isOrbital && step === 2 && (
              <div>
                <div style={{
                  background: `${T.accent}0d`, border: `1px solid ${T.accent}22`,
                  borderRadius: 6, padding: "10px 14px", marginBottom: 20,
                  fontSize: 11, color: T.textDim, lineHeight: 1.6, fontFamily: T.mono,
                }}>
                  <span style={{ color: T.accent }}>All fields optional.</span> Unspecified elements will be derived
                  from standard <span style={{ color: T.textBright }}>{form.orbit}</span> assumptions.
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <Label>Semi-Major Axis (km)</Label>
                    <Input
                      value={form.orbitalElements.sma}
                      onChange={e => upOE("sma", e.target.value)}
                      placeholder={`default: ${ORBIT_DEFAULTS[form.orbit]?.sma?.toLocaleString() ?? "—"} km`}
                      type="number"
                    />
                  </div>
                  <div>
                    <Label>Eccentricity (0–1)</Label>
                    <Input
                      value={form.orbitalElements.ecc}
                      onChange={e => upOE("ecc", e.target.value)}
                      placeholder={`default: ${ORBIT_DEFAULTS[form.orbit]?.ecc ?? "—"}`}
                      type="number"
                    />
                  </div>
                  <div>
                    <Label>Inclination (°)</Label>
                    <Input
                      value={form.orbitalElements.inc}
                      onChange={e => upOE("inc", e.target.value)}
                      placeholder={`default: ${ORBIT_DEFAULTS[form.orbit]?.inc ?? "—"}°`}
                      type="number"
                    />
                  </div>
                  <div>
                    <Label>RAAN (°)</Label>
                    <Input
                      value={form.orbitalElements.raan}
                      onChange={e => upOE("raan", e.target.value)}
                      placeholder="default: 0° (random)"
                      type="number"
                    />
                  </div>
                  <div>
                    <Label>Argument of Periapsis (°)</Label>
                    <Input
                      value={form.orbitalElements.aop}
                      onChange={e => upOE("aop", e.target.value)}
                      placeholder={`default: ${ORBIT_DEFAULTS[form.orbit]?.aop ?? "0"}°`}
                      type="number"
                    />
                  </div>
                </div>

                {/* Preview resolved elements */}
                <div style={{
                  marginTop: 18, background: T.surface, border: `1px solid ${T.border}`,
                  borderRadius: 6, padding: "12px 14px",
                }}>
                  <div style={{ fontSize: 9, color: T.textDim, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
                    Resolved Orbital Elements Preview
                  </div>
                  {(() => {
                    const r = resolveOrbitalElements(form.orbit, form.orbitalElements);
                    return (
                      <div style={{ fontFamily: T.mono, fontSize: 11, lineHeight: 2 }}>
                        {[
                          ["Body",   r.body],
                          ["SMA",    `${r.sma.toLocaleString()} km  →  Alt: ${(r.sma - r.bodyRadius).toLocaleString()} km`],
                          ["Ecc",    r.ecc.toFixed(4)],
                          ["Inc",    `${r.inc.toFixed(2)}°`],
                          ["RAAN",   `${r.raan.toFixed(1)}°`],
                          ["AoP",    `${r.aop.toFixed(1)}°`],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <span style={{ color: T.textDim, display: "inline-block", width: 60 }}>{k}</span>
                            <span style={{ color: T.accent }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Step — Constraints + Payload (last step) */}
            {step === STEPS.length - 1 && (
              <div>
                <div style={{ marginBottom: 28 }}>
                  <Label>Constraints <span style={{ color: T.textDim, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span></Label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    {[
                      { k: "mass",     label: "Mass Budget",  ph: "e.g. 500 kg"  },
                      { k: "power",    label: "Power Budget", ph: "e.g. 800 W"   },
                      { k: "lifetime", label: "Lifetime",     ph: "e.g. 5 years" },
                    ].map(({ k, label, ph }) => (
                      <div key={k}>
                        <Label>{label}</Label>
                        <Input value={form.constraints[k]} onChange={e => upConst(k, e.target.value)} placeholder={ph} />
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <Label>Payload <span style={{ color: T.textDim, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span></Label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <Label>Type</Label>
                      <select
                        value={form.payload.type}
                        onChange={e => upPay("type", e.target.value)}
                        style={{
                          background: T.surface, border: `1px solid ${T.border}`,
                          borderRadius: 5, color: form.payload.type ? T.textBright : T.textDim,
                          fontFamily: T.sans, fontSize: 13, padding: "9px 13px",
                          width: "100%", cursor: "pointer", outline: "none",
                        }}
                      >
                        <option value="">Select type...</option>
                        {PAYLOAD_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Resolution / Spec</Label>
                      <Input value={form.payload.resolution} onChange={e => upPay("resolution", e.target.value)} placeholder="e.g. 1m GSD, 50 Mbps" />
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div style={{
                  background: T.surface, border: `1px solid ${T.border}`,
                  borderRadius: 6, padding: "14px 16px",
                }}>
                  <div style={{ fontSize: 9, color: T.textDim, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
                    Mission Summary
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 12, lineHeight: 1.8 }}>
                    <span style={{ color: T.accent }}>NAME    </span>
                    <span style={{ color: T.textBright }}>{form.name}</span><br />
                    <span style={{ color: T.accent }}>ORBIT   </span>
                    <span style={{ color: T.textBright }}>{form.orbit}</span><br />
                    <span style={{ color: T.accent }}>OBJ     </span>
                    <span style={{ color: T.textBright }}>{form.objectives.filter(Boolean).length} objective(s) defined</span><br />
                    {isOrbital && (() => {
                      const r = resolveOrbitalElements(form.orbit, form.orbitalElements);
                      return (
                        <>
                          <span style={{ color: T.accent }}>ALT     </span>
                          <span style={{ color: T.textBright }}>{(r.sma - r.bodyRadius).toLocaleString()} km  ·  Inc {r.inc.toFixed(1)}°  ·  Ecc {r.ecc.toFixed(4)}</span><br />
                        </>
                      );
                    })()}
                    {form.payload.type && (
                      <>
                        <span style={{ color: T.accent }}>PAYLOAD </span>
                        <span style={{ color: T.textBright }}>{form.payload.type}{form.payload.resolution ? ` · ${form.payload.resolution}` : ""}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Nav */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, alignItems: "center" }}>
            <Btn
              onClick={() => step > 0 && setStep(s => s - 1)}
              variant="ghost"
              style={{ opacity: step === 0 ? 0 : 1, pointerEvents: step === 0 ? "none" : "auto" }}
            >
              ← Back
            </Btn>

            {!isLastStep ? (
              <Btn
                onClick={() => canNext() && setStep(s => s + 1)}
                disabled={!canNext()}
                style={{ padding: "9px 24px" }}
              >
                Next →
              </Btn>
            ) : (
              <button
                onClick={runGenerate}
                disabled={loading || !form.name}
                style={{
                  background: loading ? T.accentDark : T.accent,
                  border: "none", borderRadius: 6,
                  color: T.bg, cursor: loading ? "default" : "pointer",
                  fontFamily: T.sans, fontSize: 14, fontWeight: 800,
                  letterSpacing: "0.02em", padding: "11px 32px",
                  opacity: loading || !form.name ? 0.6 : 1,
                  transition: "all 0.15s",
                }}
              >
                {loading ? "⟳  Generating…" : "⚡  Generate Mission"}
              </button>
            )}
          </div>

          {/* Saved missions */}
          {savedMissions.length > 0 && (
            <div style={{ marginTop: 52 }}>
              <div style={{
                textAlign: "center", fontSize: 10, color: T.textDim,
                letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 16,
              }}>
                — or load a saved mission —
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
                {savedMissions.slice(0, 8).map(m => (
                  <div
                    key={m.id}
                    onClick={() => handleLoad(m.id)}
                    style={{
                      background: T.panel, border: `1px solid ${T.border}`,
                      borderRadius: 7, padding: "12px 16px", cursor: "pointer",
                      minWidth: 160, position: "relative", transition: "border-color 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.accentDark}
                    onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
                  >
                    <div style={{ fontSize: 13, color: T.textBright, fontWeight: 700 }}>{m.name}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 10, color: T.accent, marginTop: 3 }}>{m.orbit}</div>
                    <div style={{ fontSize: 10, color: T.textDim, marginTop: 5 }}>
                      {m.created_at ? new Date(m.created_at).toLocaleDateString() : ""}
                    </div>
                    <button
                      onClick={e => handleDelete(m.id, e)}
                      style={{
                        position: "absolute", top: 6, right: 8,
                        background: "transparent", border: "none",
                        color: T.textDim, cursor: "pointer", fontSize: 15, padding: 0,
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── GRAPH / ORBIT VIEW ────────────────────────────────────────────────────
  const showOrbitTab = resolvedOrbit !== null;

  return (
    <div style={{ display: "flex", height: "100vh", background: T.bg, fontFamily: T.sans }}>

      {/* LEFT PANEL */}
      <div style={{
        width: 272, flexShrink: 0,
        background: T.panel, borderRight: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>

        {/* Panel header */}
        <div style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        }}>
          <div>
            <div style={{ fontSize: 9, color: T.textDim, letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Mission Architect
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.textBright, marginTop: 3 }}>
              {form.name || "Unnamed Mission"}
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.accent, marginTop: 2 }}>
              {form.orbit}
            </div>
          </div>
          <Btn onClick={() => { setView("form"); setStep(0); }} variant="ghost" style={{ padding: "5px 10px", fontSize: 11 }}>
            ← New
          </Btn>
        </div>

        {/* Tab switcher */}
        <div style={{
          display: "flex", borderBottom: `1px solid ${T.border}`,
          background: T.surface, flexShrink: 0,
        }}>
          {[
            { id: "graph", label: "⬡ Graph" },
            ...(showOrbitTab ? [{ id: "orbit", label: "🪐 Orbit" }] : []),
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setGraphTab(tab.id)}
              style={{
                flex: 1, padding: "10px 0",
                background: graphTab === tab.id ? T.panel : "transparent",
                border: "none",
                borderBottom: `2px solid ${graphTab === tab.id ? T.accent : "transparent"}`,
                color: graphTab === tab.id ? T.textBright : T.textDim,
                fontFamily: T.sans, fontSize: 11, fontWeight: 600,
                cursor: "pointer", transition: "all 0.15s",
                letterSpacing: "0.04em",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

          {graphTab === "graph" && (
            <>
              <PanelSection title="Trace Mode">
                <div style={{ display: "flex", gap: 6 }}>
                  {["none", "upstream", "downstream"].map(m => (
                    <button
                      key={m}
                      onClick={() => { setTraceMode(m); resetView(); }}
                      style={{
                        flex: 1, background: traceMode === m ? `${T.accent}22` : "transparent",
                        border: `1px solid ${traceMode === m ? T.accent : T.border}`,
                        borderRadius: 4, color: traceMode === m ? T.accent : T.textDim,
                        padding: "5px 0", cursor: "pointer", fontSize: 10,
                        fontFamily: T.sans, fontWeight: 600, textTransform: "capitalize",
                        transition: "all 0.15s",
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <Btn onClick={resetView} variant="ghost" style={{ width: "100%", marginTop: 8, fontSize: 11 }}>
                  Reset View
                </Btn>
              </PanelSection>

              <PanelSection title="Graph Editing">
                <div style={{
                  background: `${T.accent}0d`, border: `1px solid ${T.accent}33`,
                  borderRadius: 4, padding: "8px 10px", fontSize: 10,
                  color: T.textDim, lineHeight: 1.6, fontFamily: T.mono,
                }}>
                  <span style={{ color: T.accent }}>Click</span> an edge to select it<br />
                  <span style={{ color: T.accent }}>Delete / Backspace</span> to remove<br />
                  <span style={{ color: T.accent }}>Drag</span> any node to reposition
                </div>
              </PanelSection>

              {selectedNode && (
                <PanelSection title="Selected Node" accent>
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.accentDark, marginBottom: 6 }}>
                    {selectedNode.id}
                  </div>
                  <textarea
                    rows={4}
                    defaultValue={selectedNode.data.label}
                    onBlur={e => updateNodeLabel(e.target.value)}
                    style={{
                      background: T.surface, border: `1px solid ${T.border}`,
                      borderRadius: 4, color: T.textBright, fontFamily: T.mono,
                      fontSize: 11, padding: "8px 10px", width: "100%",
                      boxSizing: "border-box", resize: "vertical", outline: "none",
                    }}
                  />
                </PanelSection>
              )}

              <PanelSection title={`AI Insights (${insights.length})`}>
                {insights.length === 0
                  ? <div style={{ color: T.textDim, fontSize: 12 }}>None flagged</div>
                  : insights.map((ins, i) => (
                    <div key={i} style={{
                      background: `${T.amber}14`, border: `1px solid ${T.amber}44`,
                      borderRadius: 4, padding: "8px 10px", fontSize: 11,
                      color: T.amber, marginBottom: 7, fontFamily: T.mono,
                      lineHeight: 1.5,
                    }}>
                      ⚠ {ins}
                    </div>
                  ))
                }
              </PanelSection>

              <PanelSection title={`Suggestions (${suggestions.length})`}>
                {suggestions.length === 0
                  ? <div style={{ color: T.textDim, fontSize: 12 }}>None available</div>
                  : suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => handleApply(s)}
                      style={{
                        width: "100%", textAlign: "left", display: "block",
                        background: `${T.green}12`, border: `1px solid ${T.green}40`,
                        borderRadius: 5, padding: "10px 12px", marginBottom: 7,
                        cursor: "pointer", transition: "all 0.15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = `${T.green}20`}
                      onMouseLeave={e => e.currentTarget.style.background = `${T.green}12`}
                    >
                      <div style={{ fontWeight: 700, fontSize: 11, color: T.green }}>+ {s.content}</div>
                      <div style={{ fontSize: 10, color: T.textDim, marginTop: 4, fontFamily: T.mono }}>
                        {s.reason}
                      </div>
                    </button>
                  ))
                }
              </PanelSection>

              {/* ── ECSS-E-10-05A Analysis Panels ─────────────────────────── */}

              {/* §3.1.2 / §4.5.3e / §4.7.6 — Validation */}
              <div style={{ marginBottom: 8 }}>
                <button onClick={() => toggleEcss("validation")} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 4, padding: "7px 10px", cursor: "pointer", color: T.textDim, fontFamily: T.sans, fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  <span>ECSS Validation</span>
                  <span style={{ color: ecssValidation && ((ecssValidation.decomposition_errors?.length || 0) + (ecssValidation.naming_errors?.length || 0) + (ecssValidation.traceability_errors?.length || 0)) > 0 ? T.red : T.green, fontSize: 11 }}>
                    {ecssOpen.validation ? "▲" : "▼"}
                  </span>
                </button>
                {ecssOpen.validation && (
                  <div style={{ padding: "10px 4px" }}>
                    <EcssValidationPanel ecssValidation={ecssValidation} />
                  </div>
                )}
              </div>

              {/* §4.8.1 — Critical Functions / FMECA candidates */}
              <div style={{ marginBottom: 8 }}>
                <button onClick={() => toggleEcss("critical")} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 4, padding: "7px 10px", cursor: "pointer", color: T.textDim, fontFamily: T.sans, fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  <span>Critical Functions ({criticalFunctions.length})</span>
                  <span style={{ fontSize: 11 }}>{ecssOpen.critical ? "▲" : "▼"}</span>
                </button>
                {ecssOpen.critical && (
                  <div style={{ padding: "10px 4px" }}>
                    <CriticalFunctionsPanel criticalFunctions={criticalFunctions} />
                  </div>
                )}
              </div>

              {/* §4.6.3 — Functional Matrix */}
              <div style={{ marginBottom: 8 }}>
                <button onClick={() => toggleEcss("matrix")} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 4, padding: "7px 10px", cursor: "pointer", color: T.textDim, fontFamily: T.sans, fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  <span>Functional Matrix</span>
                  <span style={{ fontSize: 11 }}>{ecssOpen.matrix ? "▲" : "▼"}</span>
                </button>
                {ecssOpen.matrix && (
                  <div style={{ padding: "10px 4px" }}>
                    <FunctionalMatrixPanel matrix={functionalMatrix} />
                  </div>
                )}
              </div>

              {/* §4.5.3i — Functional Interfaces */}
              <div style={{ marginBottom: 8 }}>
                <button onClick={() => toggleEcss("interfaces")} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 4, padding: "7px 10px", cursor: "pointer", color: T.textDim, fontFamily: T.sans, fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  <span>Interfaces ({interfaces.length})</span>
                  <span style={{ fontSize: 11 }}>{ecssOpen.interfaces ? "▲" : "▼"}</span>
                </button>
                {ecssOpen.interfaces && (
                  <div style={{ padding: "10px 4px" }}>
                    <InterfacesPanel interfaces={interfaces} />
                  </div>
                )}
              </div>

              {/* §5.2 — Phase Map */}
              <div style={{ marginBottom: 8 }}>
                <button onClick={() => toggleEcss("phases")} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 4, padding: "7px 10px", cursor: "pointer", color: T.textDim, fontFamily: T.sans, fontSize: 9, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  <span>Phase Map</span>
                  <span style={{ fontSize: 11 }}>{ecssOpen.phases ? "▲" : "▼"}</span>
                </button>
                {ecssOpen.phases && (
                  <div style={{ padding: "10px 4px" }}>
                    <PhaseMapPanel phaseMap={phaseMap} />
                  </div>
                )}
              </div>

            </>
          )}

          {graphTab === "orbit" && resolvedOrbit && (
            <>
              {/* ── Reference Frame ── */}
              <PanelSection title="Reference Frame" accent>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {["ECI", "ECEF"].map(f => (
                    <button key={f} onClick={() => setFrameMode(f)} style={{
                      flex: 1, padding: "7px 0", borderRadius: 5, cursor: "pointer",
                      fontFamily: T.mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                      border: `1px solid ${frameMode === f ? (f === "ECEF" ? T.amber : T.accent) : T.border}`,
                      background: frameMode === f ? (f === "ECEF" ? `${T.amber}22` : `${T.accent}22`) : "transparent",
                      color: frameMode === f ? (f === "ECEF" ? T.amber : T.accent) : T.textDim,
                      transition: "all 0.15s",
                    }}>{f}</button>
                  ))}
                </div>
                <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, lineHeight: 1.7 }}>
                  {frameMode === "ECI"
                    ? <><span style={{ color: T.accent }}>ECI</span> — inertial. Planet rotates, orbit is fixed in space.</>
                    : <><span style={{ color: T.amber }}>ECEF</span> — Earth-fixed. Orbit drifts; ground track stays on surface.</>
                  }
                </div>
              </PanelSection>

              {/* ── Orbit Direction ── */}
              <PanelSection title="Orbit Direction">
                <ToggleBtn
                  active={retrograde}
                  onClick={() => setRetrograde(v => !v)}
                  color={T.red}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {retrograde ? "↻ Prograde" : "↺ Retrograde"}
                </ToggleBtn>
                <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, lineHeight: 1.7, marginTop: 8 }}>
                  {retrograde
                    ? <><span style={{ color: T.accent }}>Prograde</span> — satellite orbits in the direction of body rotation.</>
                    : <><span style={{ color: T.red }}>Retrograde</span> — satellite orbits opposite to body rotation.</>
                  }
                </div>
              </PanelSection>

              {/* ── Playback ── */}
              <PanelSection title="Playback">
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <ToggleBtn
                    active={isPlaying}
                    onClick={() => setIsPlaying(v => !v)}
                    color={T.green}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    {isPlaying ? "⏸ Pause" : "▶ Play"}
                  </ToggleBtn>
                </div>
                {!isPlaying && (
                  <div>
                    <div style={{ fontSize: 9, color: T.textDim, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6, fontFamily: T.sans }}>
                      Time Scrubber
                    </div>
                    <input
                      type="range" min={0} max={1000} value={Math.round(scrubT * 1000)}
                      onChange={e => setScrubT(parseInt(e.target.value) / 1000)}
                      style={{ width: "100%", accentColor: T.accent, cursor: "pointer" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.textDim, fontFamily: T.mono, marginTop: 2 }}>
                      <span>0%</span>
                      <span style={{ color: T.accent }}>{(scrubT * 100).toFixed(1)}%</span>
                      <span>100%</span>
                    </div>
                  </div>
                )}
              </PanelSection>

              {/* ── Layer toggles ── */}
              <PanelSection title="Layer Toggles">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { key: "orbitPlane",     label: "Orbit Plane",      icon: "⬡", color: T.accent },
                    { key: "velocityVector", label: "Velocity Vector",  icon: "→", color: T.amber },
                    { key: "nodeVectors",    label: "Node Vectors",     icon: "↕", color: T.green },
                    { key: "groundTrack",    label: "Ground Track",     icon: "〰", color: "#f59e0b" },
                    { key: "groundStation",  label: "Ground Station",   icon: "📡", color: T.red },
                  ].map(({ key, label, icon, color }) => (
                    <ToggleBtn
                      key={key}
                      active={layers[key]}
                      onClick={() => toggleLayer(key)}
                      color={color}
                      style={{ width: "100%", justifyContent: "flex-start" }}
                    >
                      <span style={{ fontSize: 12, width: 16 }}>{icon}</span>
                      {label}
                    </ToggleBtn>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 9, color: T.textDim, fontFamily: T.mono, lineHeight: 1.6 }}>
                  <span style={{ color: "#22c55e" }}>↑ green</span> = ascending node ·{" "}
                  <span style={{ color: "#ef4444" }}>↓ red</span> = descending<br />
                  <span style={{ color: "#f59e0b" }}>〰</span> = 3-orbit ground track (ECEF coords)<br />
                  <span style={{ color: T.red }}>📡</span> = Paris ground station
                </div>
              </PanelSection>

              {/* ── Measurement tools ── */}
              <PanelSection title="Measurement Tools">
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {[
                    { id: "distance", label: "📏 Distance", hint: "Click 2 orbit points" },
                    { id: "angle",    label: "📐 Angle",    hint: "Click 3 orbit points" },
                  ].map(({ id, label, hint }) => (
                    <ToggleBtn
                      key={id}
                      active={toolMode === id}
                      onClick={() => { setToolMode(t => t === id ? "none" : id); setMeasurePts([]); setMeasureResult(null); }}
                      color={T.amber}
                      style={{ width: "100%", justifyContent: "flex-start" }}
                    >
                      {label}
                      <span style={{ fontSize: 9, color: T.textDim, marginLeft: "auto" }}>{hint}</span>
                    </ToggleBtn>
                  ))}
                </div>
                {toolMode !== "none" && (
                  <div style={{
                    background: `${T.amber}0f`, border: `1px solid ${T.amber}33`,
                    borderRadius: 4, padding: "8px 10px", fontSize: 10, fontFamily: T.mono,
                    color: T.textDim, lineHeight: 1.6,
                  }}>
                    {toolMode === "distance" && (
                      <>
                        <span style={{ color: T.amber }}>Click</span> two points on the orbit path.<br />
                        Points: {measurePts.length}/2
                      </>
                    )}
                    {toolMode === "angle" && (
                      <>
                        <span style={{ color: T.amber }}>Click</span> three points (vertex in middle).<br />
                        Points: {measurePts.length}/3
                      </>
                    )}
                  </div>
                )}
                {measureResult && (
                  <div style={{
                    marginTop: 8, background: `${T.green}0f`, border: `1px solid ${T.green}44`,
                    borderRadius: 4, padding: "8px 10px",
                  }}>
                    <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>Result</div>
                    <div style={{ fontFamily: T.mono, fontSize: 12, color: T.green }}>{measureResult.value}</div>
                  </div>
                )}
                {(measurePts.length > 0 || measureResult) && (
                  <Btn onClick={() => { setMeasurePts([]); setMeasureResult(null); }} variant="ghost" style={{ width: "100%", marginTop: 6, fontSize: 10 }}>
                    Clear Markers
                  </Btn>
                )}
              </PanelSection>

              {/* ── Orbital elements reference ── */}
              <PanelSection title="Elements">
                {[
                  ["Body",        resolvedOrbit.body],
                  ["SMA",         `${resolvedOrbit.sma.toLocaleString()} km`],
                  ["Altitude",    `${(resolvedOrbit.sma - resolvedOrbit.bodyRadius).toLocaleString()} km`],
                  ["Eccentricity",resolvedOrbit.ecc.toFixed(4)],
                  ["Inclination", `${resolvedOrbit.inc.toFixed(2)}°`],
                  ["RAAN",        `${resolvedOrbit.raan.toFixed(1)}°`],
                  ["Arg. of Peri",`${resolvedOrbit.aop.toFixed(1)}°`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${T.border}`, fontSize: 10 }}>
                    <span style={{ color: T.textDim }}>{k}</span>
                    <span style={{ color: T.accent, fontFamily: T.mono }}>{v}</span>
                  </div>
                ))}
              </PanelSection>
            </>
          )}

        </div>

        {/* Footer — missions toggle */}
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}` }}>
          <Btn
            onClick={() => { setShowMissions(v => !v); if (!showMissions) fetchSaved(); }}
            variant="ghost"
            style={{ width: "100%", fontSize: 11 }}
          >
            {showMissions ? "▲" : "▼"} Saved Missions ({savedMissions.length})
          </Btn>
        </div>
      </div>

      {/* MAIN AREA */}
      <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>

        {/* GRAPH CANVAS */}
        <div style={{ flex: 1, position: "relative", display: graphTab === "graph" ? "flex" : "none", flexDirection: "column" }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              deleteKeyCode={["Delete", "Backspace"]}
              fitView
            >
              <MiniMap
                style={{ background: T.surface, border: `1px solid ${T.border}` }}
                nodeColor={n => {
                  if (n.style?.background) return n.style.background;
                  return T.border;
                }}
              />
              <Controls />
              <Background color={T.border} gap={32} size={1} />
            </ReactFlow>

            {/* Saved missions slide-up panel */}
            {showMissions && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                background: T.panel, borderTop: `1px solid ${T.borderHi}`,
                maxHeight: 290, overflowY: "auto", padding: "16px 20px",
                zIndex: 10,
              }}>
                <div style={{
                  fontSize: 9, color: T.textDim, letterSpacing: "0.16em",
                  textTransform: "uppercase", marginBottom: 14,
                }}>
                  Saved Missions
                </div>

                {savedMissions.length === 0
                  ? <div style={{ color: T.textDim, fontSize: 12 }}>No saved missions yet</div>
                  : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {savedMissions.map(m => (
                        <div
                          key={m.id}
                          onClick={() => handleLoad(m.id)}
                          style={{
                            background: m.id === currentMissionId ? `${T.accent}18` : T.surface,
                            border: `1px solid ${m.id === currentMissionId ? T.accent : T.border}`,
                            borderRadius: 7, padding: "12px 16px", cursor: "pointer",
                            minWidth: 180, position: "relative", transition: "border-color 0.15s",
                          }}
                          onMouseEnter={e => { if (m.id !== currentMissionId) e.currentTarget.style.borderColor = T.accentDark; }}
                          onMouseLeave={e => { if (m.id !== currentMissionId) e.currentTarget.style.borderColor = T.border; }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 700, color: T.textBright }}>{m.name}</div>
                          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.accent, marginTop: 3 }}>{m.orbit}</div>
                          <div style={{ fontSize: 10, color: T.textDim, marginTop: 5 }}>
                            {m.objectives?.slice(0, 1).join("") || ""}
                          </div>
                          <div style={{ fontSize: 9, color: T.textDim, marginTop: 4 }}>
                            {m.created_at ? new Date(m.created_at).toLocaleDateString() : ""}
                          </div>
                          <button
                            onClick={e => handleDelete(m.id, e)}
                            style={{
                              position: "absolute", top: 7, right: 9,
                              background: "transparent", border: "none",
                              color: T.textDim, cursor: "pointer", fontSize: 15, padding: 0,
                            }}
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )
                }
              </div>
            )}
          </div>

        {/* ORBITAL VIEWER — always mounted so layer toggles take effect instantly */}
        <div style={{ flex: 1, display: graphTab === "orbit" ? "flex" : "none", flexDirection: "column" }}>
          <OrbitalViewer
            orbitalElements={resolvedOrbit}
            layers={layers}
            toolMode={toolMode}
            scrubT={scrubT}
            isPlaying={isPlaying}
            measurePts={measurePts}
            frameMode={frameMode}
            retrograde={retrograde}
            onMeasurePt={(pt) => {
              const maxPts = toolMode === "angle" ? 3 : 2;
              setMeasurePts(prev => {
                const next = [...prev, pt].slice(-maxPts);
                if (toolMode === "distance" && next.length === 2) {
                  const d_units = next[0].distanceTo(next[1]);
                  const d_km = d_units / (1 / (resolvedOrbit?.bodyRadius || 6371));
                  setMeasureResult({ type: "distance", value: `${d_km.toFixed(1)} km` });
                } else if (toolMode === "angle" && next.length === 3) {
                  const v1 = next[0].clone().sub(next[1]).normalize();
                  const v2 = next[2].clone().sub(next[1]).normalize();
                  const ang = Math.acos(Math.max(-1, Math.min(1, v1.dot(v2)))) * 180 / Math.PI;
                  setMeasureResult({ type: "angle", value: `${ang.toFixed(2)}°` });
                } else {
                  setMeasureResult(null);
                }
                return next;
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}