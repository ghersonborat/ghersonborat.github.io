// One bit per problem, in the catalog's stable order. No reading history,
// selected answers, scores, timestamps, or drafts are stored.
export const COMPLETION_COOKIE = 'gre-companion-completed-v1';

export function encodeCompletion(problemIds, completed) {
  const digits = Array(Math.ceil(problemIds.length / 4)).fill(0);
  problemIds.forEach((id, i) => { if (completed.has(id)) digits[i >> 2] |= 1 << (i % 4); });
  return digits.map(digit => digit.toString(16)).join('');
}

export function decodeCompletion(value, problemIds) {
  if (typeof value !== 'string' || value.length !== Math.ceil(problemIds.length / 4) || !/^[0-9a-f]+$/i.test(value)) return new Set();
  return new Set(problemIds.filter((id, i) => parseInt(value[i >> 2], 16) & (1 << (i % 4))));
}

export function readCompletion(cookie, problemIds) {
  const value = String(cookie).split(';').map(part => part.trim()).find(part => part.startsWith(COMPLETION_COOKIE + '='))?.slice(COMPLETION_COOKIE.length + 1);
  return decodeCompletion(value, problemIds);
}

export function cookiePath(pathname) {
  // Scope to this static site, including GitHub Pages project subdirectories.
  const path = pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/';
  return /[;\r\n]/.test(path) ? '/' : path;
}

export function saveCompletion(doc, location, problemIds, completed) {
  try {
    // Merge at write time so another tab's completed problems are retained.
    for (const id of readCompletion(doc.cookie, problemIds)) completed.add(id);
    const value = encodeCompletion(problemIds, completed);
    doc.cookie = `${COMPLETION_COOKIE}=${value}; Path=${cookiePath(location.pathname)}; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    const saved = readCompletion(doc.cookie, problemIds);
    return [...completed].every(id => saved.has(id));
  } catch {
    return false;
  }
}
