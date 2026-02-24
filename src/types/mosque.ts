export type Mosque = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  lastUpdated: number;
};

export type TravelMode = "walk" | "drive";

export type MosquesSettings = {
  radiusKm: number;
  travelMode: TravelMode;
};
