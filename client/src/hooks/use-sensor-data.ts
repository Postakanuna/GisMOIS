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

export interface SensorObjectBinding {
  id: number;
  idCdsKoteln: number;
  objectType: string;
  layerId: number;
  objectName: string;
  createdAt: string;
}

export function useSensorBindings() {
  return useQuery<SensorObjectBinding[]>({
    queryKey: ["/api/sensor-bindings"],
    staleTime: 60_000,
  });
}

export function useSensorReadings() {
  return useQuery<SensorReading[]>({
    queryKey: ["/api/sensor-readings"],
    staleTime: 60_000,
  });
}

export function useSensorDataForLayer(layerId: number | undefined) {
  const { data: bindings } = useSensorBindings();
  const { data: readings } = useSensorReadings();

  if (!layerId || !bindings || !readings) return null;

  const binding = bindings.find(b => b.layerId === layerId);
  if (!binding) return null;

  const reading = readings.find(r => r.idCdsKoteln === binding.idCdsKoteln);
  if (!reading) return null;

  return { binding, reading };
}
