/** Shared fuzzy search used by standard wording, recommendations, and costs. */

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchTokens(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const cur = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

function typoBudget(token: string): number {
  if (token.length >= 7) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

/** True when `token` appears in `hay` exactly, as a prefix, or within typo budget. */
export function tokenMatchesHay(hay: string, token: string): boolean {
  if (!token) return true;
  if (hay.includes(token)) return true;

  const words = hay.split(/\s+/).filter(Boolean);
  const budget = typoBudget(token);

  for (const word of words) {
    if (word.startsWith(token) || (token.startsWith(word) && word.length >= 2)) {
      return true;
    }
    if (budget > 0 && Math.abs(word.length - token.length) <= budget) {
      if (levenshtein(word, token) <= budget) return true;
    }
  }

  if (budget > 0 && token.length >= 4) {
    for (let i = 0; i + token.length - budget <= hay.length; i++) {
      const slice = hay.slice(i, i + token.length + budget);
      for (let len = token.length - budget; len <= token.length + budget; len++) {
        if (len < 2) continue;
        const piece = slice.slice(0, len);
        if (!piece || Math.abs(piece.length - token.length) > budget) continue;
        if (levenshtein(piece, token) <= budget) return true;
      }
    }
  }

  return false;
}

export type SearchableItem = {
  id: string;
  title: string;
  group?: string;
  keywords?: string[];
  text?: string;
};

export function itemHaystack(item: SearchableItem): string {
  return normalizeSearchText(
    [
      item.title,
      item.group ?? "",
      ...(item.keywords ?? []),
      (item.text ?? "").slice(0, 280)
    ].join(" ")
  );
}

/** Higher = closer match for the search box / Enter-to-pick. */
export function searchScore(item: SearchableItem, q: string): number {
  const toks = searchTokens(q);
  if (toks.length === 0) return 0;

  const topic = normalizeSearchText(item.title);
  const group = normalizeSearchText(item.group ?? "");
  const keywords = (item.keywords ?? []).map((k) => normalizeSearchText(k));
  const text = normalizeSearchText((item.text ?? "").slice(0, 280));
  const hay = itemHaystack(item);
  let s = 0;

  const joined = toks.join(" ");
  if (topic === joined) s += 1000;
  else if (topic.startsWith(joined)) s += 520;
  else if (topic.includes(joined)) s += 320;

  for (const token of toks) {
    if (topic === token) s += 420;
    else if (topic.startsWith(token) || topic.split(/\s+/).some((w) => w.startsWith(token)))
      s += 260;
    else if (tokenMatchesHay(topic, token)) s += 180;

    for (const kw of keywords) {
      if (kw === token) s += 360;
      else if (kw.startsWith(token)) s += 200;
      else if (tokenMatchesHay(kw, token)) s += 120;
    }

    if (tokenMatchesHay(group, token)) s += 40;
    if (tokenMatchesHay(text, token)) s += 10;
    if (tokenMatchesHay(hay, token)) s += 4;
  }

  if (toks.every((t) => tokenMatchesHay(topic, t))) s += 140;

  return s;
}

export function matchesQuery(item: SearchableItem, q: string): boolean {
  const toks = searchTokens(q);
  if (toks.length === 0) return true;
  const hay = itemHaystack(item);
  return toks.every((token) => tokenMatchesHay(hay, token));
}

export function bestSearchMatch<T extends SearchableItem>(
  items: T[],
  query: string
): T | null {
  const toks = searchTokens(query);
  if (toks.length === 0) return null;
  const candidates = items.filter((p) => matchesQuery(p, query));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  let best = candidates[0]!;
  let bestS = searchScore(best, query);
  for (let i = 1; i < candidates.length; i++) {
    const p = candidates[i]!;
    const s = searchScore(p, query);
    if (s > bestS) {
      best = p;
      bestS = s;
    }
  }
  return best;
}

export function rankedMatches<T extends SearchableItem>(
  items: T[],
  query: string
): T[] {
  const toks = searchTokens(query);
  if (toks.length === 0) return items;
  return items
    .filter((p) => matchesQuery(p, query))
    .sort((a, b) => searchScore(b, query) - searchScore(a, query));
}

export function alphaSort<T>(items: T[], label: (item: T) => string): T[] {
  return items.slice().sort((a, b) =>
    label(a).localeCompare(label(b), "en", { sensitivity: "base" })
  );
}

/** Selected items first (A–Z), then the rest in original alphabetical order. */
export function selectedThenAlpha<T>(
  items: T[],
  selected: (item: T) => boolean,
  label: (item: T) => string
): T[] {
  const ordered = alphaSort(items, label);
  return [
    ...ordered.filter(selected),
    ...ordered.filter((item) => !selected(item))
  ];
}
