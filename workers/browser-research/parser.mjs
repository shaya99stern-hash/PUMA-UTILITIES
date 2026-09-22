const ROLE_PATTERN = /\b(owner|founder|co-founder|principal|partner|chair|chairman|president|chief|ceo|coo|cfo|cto|vice president|vp|director|head|manager|property manager|asset manager|operations|facilities|acquisitions|development)\b/i;
const IGNORE_PATTERN = /^(view|download|staff directory|decision makers|all|c-suite|sales|engineering|operations|image:|\(••\)|\*{3,}|see all|headcount|outreach toolkit|frequently asked)/i;

export function parseContactOutStaff(text, sourceUrl, maxPeople = 20) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const staffStart = lines.findIndex((line) => /staff directory/i.test(line));
  const decisionStart = lines.findIndex((line) => /decision makers by function/i.test(line));
  const start = staffStart >= 0 ? staffStart + 1 : decisionStart >= 0 ? decisionStart + 1 : 0;
  const scoped = lines.slice(start, start + 260);
  const people = [];
  const seen = new Set();

  for (let index = 0; index < scoped.length - 1 && people.length < maxPeople; index += 1) {
    const name = cleanName(scoped[index]);
    if (!name || IGNORE_PATTERN.test(name) || !looksLikePersonName(name)) continue;

    let title;
    for (let lookahead = 1; lookahead <= 3 && index + lookahead < scoped.length; lookahead += 1) {
      const candidate = scoped[index + lookahead];
      if (IGNORE_PATTERN.test(candidate)) continue;
      if (ROLE_PATTERN.test(candidate) && candidate.length <= 140) {
        title = candidate;
        break;
      }
      if (looksLikePersonName(candidate)) break;
    }
    if (!title) continue;

    const key = `${name.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ name, title, sourceUrl, visibility: 'public' });
  }

  return people;
}

function cleanName(value) {
  return value.replace(/^Image:\s*/i, '').replace(/\s+[A-Z]{1,3}$/, '').trim();
}

function looksLikePersonName(value) {
  if (value.length < 4 || value.length > 80 || /[@$%|]/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((word) => /^[A-Za-zÀ-ÖØ-öø-ÿ'’.-]+$/.test(word));
}
