import type {DeliveryStop, RouteOption} from '../types/delivery';

export function createEmptyStop(id: number): DeliveryStop {
  return {
    id,
    label: '',
    address: '',
    position: null,
    travelTimeMinutes: 0,
  };
}

export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentTimeString(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Computes cumulative travel time before reaching each stop.
 * Start location begins at 0 min; each following stop accumulates prior leg durations.
 */
export function computeArrivalOffsets(legDurations: number[]): number[] {
  const offsets: number[] = new Array(legDurations.length).fill(0);
  for (let i = 0; i < legDurations.length; i++) {
    let total = 0;
    for (let j = 0; j < i; j++) {
      total += legDurations[j];
    }
    offsets[i] = total;
  }
  return offsets;
}

export function buildDepartureDate(
  startDateStr: string,
  startTimeStr: string
): Date {
  const safeDate = startDateStr || getTodayDateString();
  const safeTime = startTimeStr || '09:00';
  const [y, m, d] = safeDate.split('-').map((n) => Number.parseInt(n, 10));
  const [hh, mm] = safeTime.split(':').map((n) => Number.parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

export function formatClockEta(
  departureHHMM: string,
  offsetMinutes: number,
  startDateStr?: string
): string {
  const baseDate = buildDepartureDate(
    startDateStr || getTodayDateString(),
    departureHHMM
  );
  const target = new Date(baseDate.getTime() + Math.round(offsetMinutes) * 60000);
  const h24 = target.getHours();
  const m = target.getMinutes();
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const timeText = `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;

  const todayStr = getTodayDateString();
  const targetStr = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;

  if (targetStr !== todayStr) {
    const dateLabel = target.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return `${dateLabel}, ${timeText}`;
  }
  return timeText;
}

export function formatDurationLabel(totalMinutes: number): string {
  const rounded = Math.max(0, Math.round(totalMinutes));
  if (rounded < 60) return `${rounded} min`;
  const hrs = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins === 0 ? `${hrs} hr` : `${hrs} hr ${mins} min`;
}

export function formatDistanceKm(meters?: number): string {
  if (!meters || meters <= 0) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Evaluates returned routes and picks the best option balancing less time and shorter distance.
 */
export function scoreAndTagRoutes(
  rawRoutes: Omit<
    RouteOption,
    'isFastest' | 'isShortest' | 'isRecommended'
  >[]
): {routes: RouteOption[]; recommendedIndex: number} {
  if (rawRoutes.length === 0) {
    return {routes: [], recommendedIndex: 0};
  }

  const minDuration = Math.max(
    1,
    Math.min(...rawRoutes.map((r) => r.totalDurationMinutes))
  );
  const positiveDistances = rawRoutes
    .map((r) => r.totalDistanceMeters)
    .filter((d) => d > 0);
  const minDistance =
    positiveDistances.length > 0 ? Math.min(...positiveDistances) : 1;

  let bestScore = Number.POSITIVE_INFINITY;
  let recommendedIdx = 0;

  rawRoutes.forEach((route, idx) => {
    const timeRatio = route.totalDurationMinutes / minDuration;
    const distRatio =
      route.totalDistanceMeters > 0
        ? route.totalDistanceMeters / minDistance
        : 1;
    // Weighted toward time (60%) and distance (40%) to suggest best combined efficiency
    const score = timeRatio * 0.6 + distRatio * 0.4;
    if (score < bestScore) {
      bestScore = score;
      recommendedIdx = idx;
    }
  });

  const routes: RouteOption[] = rawRoutes.map((r, idx) => ({
    ...r,
    isFastest: r.totalDurationMinutes <= minDuration,
    isShortest:
      r.totalDistanceMeters > 0 && r.totalDistanceMeters <= minDistance,
    isRecommended: idx === recommendedIdx,
  }));

  return {routes, recommendedIndex: recommendedIdx};
}
