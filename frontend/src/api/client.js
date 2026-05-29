const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail = typeof data === "object" && data?.detail ? data.detail : data;
    throw new Error(detail || `Request failed: ${response.status}`);
  }

  return data;
}

export function getHealth() {
  return request("/api/health");
}

export function getModelStatus() {
  return request("/api/model/status");
}

export function getGibsLayers(date) {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  return request(`/api/gibs/layers${q}`);
}

export function refreshBackend() {
  return request("/api/refresh", { method: "POST" });
}

export function getRainfall(points) {
  return request("/api/rainfall/points", {
    method: "POST",
    body: JSON.stringify({ points })
  });
}

export function classifyGeoBBox(payload) {
  return request("/api/cloud/classify-bbox", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function searchOpenMeteoLocation(query) {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
    "&count=8&language=id&format=json";

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Pencarian lokasi gagal.");
  }

  const data = await response.json();
  return data.results || [];
}
