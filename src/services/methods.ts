export interface MethodItem {
  key: string;
  id: number;
  name: string;
  params: Record<string, string | number>;
}

const BASE_URL = "https://api.aladhan.com/v1";

const FALLBACK_METHODS: MethodItem[] = [
  { key: "MWL", id: 3, name: "Muslim World League", params: { Fajr: 18, Isha: 17 } },
  { key: "TURKEY", id: 13, name: "Diyanet Isleri Baskanligi, Turkey", params: { Fajr: 18, Isha: 17 } },
  { key: "ISNA", id: 2, name: "Islamic Society of North America", params: { Fajr: 15, Isha: 15 } },
  { key: "EGYPT", id: 5, name: "Egyptian General Authority of Survey", params: { Fajr: 19.5, Isha: 17.5 } },
  { key: "MAKKAH", id: 4, name: "Umm Al-Qura University, Makkah", params: { Fajr: 18.5, Isha: "90 min" } },
  { key: "KARACHI", id: 1, name: "University of Islamic Sciences, Karachi", params: { Fajr: 18, Isha: 18 } }
];

const PREFERRED_ORDER = [
  "MWL",
  "TURKEY",
  "ISNA",
  "EGYPT",
  "MAKKAH",
  "KARACHI",
  "MOONSIGHTING",
  "QATAR",
  "KUWAIT",
  "SINGAPORE",
  "TEHRAN",
  "JAFARI"
];

function compareMethods(a: MethodItem, b: MethodItem): number {
  const ai = PREFERRED_ORDER.indexOf(a.key);
  const bi = PREFERRED_ORDER.indexOf(b.key);

  if (ai !== -1 && bi !== -1) {
    return ai - bi;
  }
  if (ai !== -1) {
    return -1;
  }
  if (bi !== -1) {
    return 1;
  }

  return a.name.localeCompare(b.name);
}

export function summarizeMethodParams(params: Record<string, string | number>): string {
  const fajr = params.Fajr;
  const isha = params.Isha;
  const shafaq = params.shafaq;

  const chunks: string[] = [];
  if (fajr !== undefined) {
    chunks.push(`Fajr: ${fajr}`);
  }
  if (isha !== undefined) {
    chunks.push(`Isha: ${isha}`);
  }
  if (shafaq !== undefined) {
    chunks.push(`Shafaq: ${shafaq}`);
  }

  return chunks.length > 0 ? chunks.join(", ") : "No params available";
}

export async function fetchMethods(): Promise<MethodItem[]> {
  try {
    const response = await fetch(`${BASE_URL}/methods`);
    if (!response.ok) {
      throw new Error(`Aladhan methods error: ${response.status}`);
    }

    const payload = await response.json();
    const data = payload?.data;
    if (!data || typeof data !== "object") {
      throw new Error("Invalid methods payload");
    }

    const parsed = Object.entries(data)
      .map(([key, value]) => {
        const item = value as any;
        return {
          key,
          id: Number(item?.id),
          name: String(item?.name ?? key),
          params: (item?.params ?? {}) as Record<string, string | number>
        } as MethodItem;
      })
      .filter((item) => Number.isFinite(item.id) && item.id !== 99)
      .sort(compareMethods);

    if (parsed.length === 0) {
      return FALLBACK_METHODS;
    }

    return parsed;
  } catch {
    return FALLBACK_METHODS;
  }
}
