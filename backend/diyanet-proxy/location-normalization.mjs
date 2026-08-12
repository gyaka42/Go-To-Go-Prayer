const latinCompatibilityMap = new Map([
  ["ı", "i"],
  ["ł", "l"],
  ["đ", "d"],
  ["ð", "d"],
  ["þ", "th"],
  ["ø", "o"],
  ["æ", "ae"],
  ["œ", "oe"],
  ["ß", "ss"],
  ["ħ", "h"],
  ["ŋ", "n"]
]);

const countryAliases = {
  DE: ["germany", "deutschland", "almanya"],
  NL: ["netherlands", "nederland", "holland", "hollanda"],
  TR: ["turkey", "turkiye", "tuerkiye"],
  GB: ["uk", "united kingdom", "england", "birlesik krallik"],
  US: ["usa", "united states", "america", "amerika", "abd"]
};

const countryDisplayLocales = ["en", "tr", "nl", "de", "fr", "es", "pt", "it"];

function foldCompatibilityCharacters(value) {
  return Array.from(value, (character) => latinCompatibilityMap.get(character) ?? character).join("");
}

export function normalizeSearchText(value) {
  const decomposed = String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase();

  return foldCompatibilityCharacters(decomposed)
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeText(value) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

export function buildLocationSearchTerms(...values) {
  const terms = [];
  const seen = new Set();

  for (const value of values) {
    const raw = String(value || "").trim().replace(/\s+/g, " ");
    const folded = normalizeSearchText(raw);
    for (const candidate of [raw, folded]) {
      const key = candidate.toLowerCase();
      if (!candidate || !key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      terms.push(candidate);
    }
  }

  return terms;
}

export function nameMatchScore(candidate, hints) {
  const candidateNorm = normalizeText(candidate);
  if (!candidateNorm) {
    return 0;
  }

  let best = 0;
  for (const hint of hints) {
    const hintNorm = normalizeText(hint);
    if (!hintNorm) {
      continue;
    }
    if (candidateNorm === hintNorm) {
      best = Math.max(best, 100);
    } else if (candidateNorm.startsWith(hintNorm) || hintNorm.startsWith(candidateNorm)) {
      best = Math.max(best, 65);
    } else if (candidateNorm.includes(hintNorm) || hintNorm.includes(candidateNorm)) {
      best = Math.max(best, 35);
    }
  }
  return best;
}

export function normalizedCountryHints(countryCode, countryName) {
  const hints = new Set();
  const requestedCode = String(countryCode || "").trim().toUpperCase();
  const countryNameNorm = normalizeText(countryName);
  const inferredCode = Object.entries(countryAliases).find(([, aliases]) =>
    aliases.some((alias) => normalizeText(alias) === countryNameNorm)
  )?.[0];
  const code = requestedCode || inferredCode || "";
  const add = (value) => {
    const normalized = normalizeText(value);
    if (normalized) {
      hints.add(normalized);
    }
  };

  add(requestedCode);
  add(countryName);
  for (const alias of countryAliases[code] || []) {
    add(alias);
  }

  if (/^[A-Z]{2}$/.test(code) && typeof Intl.DisplayNames === "function") {
    for (const locale of countryDisplayLocales) {
      try {
        add(new Intl.DisplayNames([locale], { type: "region" }).of(code));
      } catch {
        // Locale data differs per Node runtime; aliases and the raw name remain available.
      }
    }
  }

  return Array.from(hints);
}
