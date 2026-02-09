const BASE_URL = "https://api.aladhan.com/v1";

export async function getQiblaDirection(lat: number, lon: number): Promise<number> {
  const response = await fetch(`${BASE_URL}/qibla/${lat}/${lon}`);
  if (!response.ok) {
    throw new Error("Could not fetch Qibla direction right now.");
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Received invalid Qibla response.");
  }

  const direction = Number(payload?.data?.direction);
  if (!Number.isFinite(direction)) {
    throw new Error("Qibla direction is unavailable for this location.");
  }

  return direction;
}

export function getQiblaCompassImageUrl(lat: number, lon: number, size = 512): string {
  return `${BASE_URL}/qibla/${lat}/${lon}/compass/${size}`;
}

