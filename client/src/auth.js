export const ADMIN_TOKEN_KEY = "geohealth_admin_token";

export function getAdminToken() {
  return window.localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token) {
  window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function authHeaders(token = getAdminToken()) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
