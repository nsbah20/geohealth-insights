export const ADMIN_TOKEN_KEY = "geohealth_admin_token";
export const SESSION_EXPIRY_WARNING_MS = 5 * 60 * 1000;

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

export function getSessionTimeRemaining(user) {
  if (!user?.expiresAt) return null;
  const expiresAt = new Date(user.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return null;
  return Math.max(0, expiresAt - Date.now());
}

export function isSessionExpired(user) {
  const remaining = getSessionTimeRemaining(user);
  return remaining !== null && remaining <= 0;
}

export function isSessionExpiringSoon(user, warningMs = SESSION_EXPIRY_WARNING_MS) {
  const remaining = getSessionTimeRemaining(user);
  return remaining !== null && remaining > 0 && remaining <= warningMs;
}

export function formatSessionExpiry(user) {
  if (!user?.expiresAt) return "Unknown";
  return new Date(user.expiresAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatSessionTimeRemaining(user) {
  const remaining = getSessionTimeRemaining(user);
  if (remaining === null) return "";
  if (remaining <= 0) return "expired";

  const totalMinutes = Math.ceil(remaining / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}
