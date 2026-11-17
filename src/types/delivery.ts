export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface DeliveryStop {
  id: number;
  label: string;
  address: string;
  position: LatLngPoint | null;
  travelTimeMinutes: number;
  distanceMeters?: number;
}

export interface RouteLegGeometry {
  fromStopIndex: number;
  toStopIndex: number;
  path: LatLngPoint[];
  durationMinutes: number;
  distanceMeters: number;
}

export interface RouteOption {
  id: string;
  index: number;
  summary: string;
  totalDurationMinutes: number;
  totalDistanceMeters: number;
  legs: RouteLegGeometry[];
  viewport?: google.maps.LatLngBoundsLiteral | google.maps.LatLngBounds | null;
  isFastest: boolean;
  isShortest: boolean;
  isRecommended: boolean;
}
