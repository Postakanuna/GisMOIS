import { useQuery } from "@tanstack/react-query";

export interface SensorReading {
  id: number;
  idCdsKoteln: number;
  mrName: string | null;
  placeName: string | null;
  nameKoteln: string | null;
  address: string | null;
  rsoName: string | null;
  type: string | null;
  mkdCount: number | null;
  mkdPeopleCount: number | null;
  activeClaims: number[];
  sensorsState: string | null;
  sensorDate: string | null;
  tForward: number | null;
  tReverse: number | null;
  pForward: number | null;
  pRevers: number | null;
  responsibles: { full_name: string; phone: string; position: string; messenger?: string; email?: string }[];
  fetchedAt: string;
}

export function useSensorReadings() {
  return useQuery<SensorReading[]>({
    queryKey: ["/api/sensor-readings"],
    staleTime: 60_000,
  });
}

export function useSensorDataBySensorId(sensorId: number | string | undefined | null) {
  const { data: readings } = useSensorReadings();

  if (sensorId == null || sensorId === "" || !readings) return null;

  const id = Number(sensorId);
  if (isNaN(id)) return null;

  return readings.find(r => r.idCdsKoteln === id) ?? null;
}
