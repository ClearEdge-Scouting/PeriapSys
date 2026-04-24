import axios from "axios";

const API_URL = "http://localhost:8000";

// ─── Generation ───────────────────────────────────────────────────────────────

export const generateSystem = async (payload) => {
  const res = await axios.post(`${API_URL}/generate`, payload);
  return res.data;
};

export const applySuggestion = async (graph, suggestion) => {
  const res = await axios.post(`${API_URL}/apply-suggestion`, { graph, suggestion });
  return res.data;
};

// ─── Mission persistence ──────────────────────────────────────────────────────

export const listMissions = async () => {
  const res = await axios.get(`${API_URL}/missions`);
  return res.data;
};

export const loadMission = async (id) => {
  const res = await axios.get(`${API_URL}/missions/${id}`);
  return res.data;
};

export const deleteMission = async (id) => {
  const res = await axios.delete(`${API_URL}/missions/${id}`);
  return res.data;
};