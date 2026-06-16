export interface GlobalMetrics {
  onlineAccountCounter: number;
  weeklyPeakPlayers: number;
  accountCounter: number;
  characterCounter: number;
  propertyCounter: number;
  vehicleCounter: number;
  factionCounter: number;
  weaponCounter: number;
}

export interface GlobalMetricsResponse {
  generatedAt: string;
  data: GlobalMetrics;
}
