export function formatDate(date) {
  if (!date) return 'ещё не проверялся';
  const d = new Date(date);
  return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

export function extractDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname;
  } catch {
    return urlStr;
  }
}
