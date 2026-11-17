import {useEffect, useMemo, useRef, useState} from 'react';
import {
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import {Navigation, RefreshCw} from 'lucide-react';
import type {
  DeliveryStop,
  LatLngPoint,
  RouteLegGeometry,
  RouteOption,
} from '../types/delivery';
import {
  buildDepartureDate,
  formatClockEta,
  formatDistanceKm,
  formatDurationLabel,
  scoreAndTagRoutes,
} from '../utils/routeTimes';
import {checkAndEmitQuotaError} from '../utils/quotaHandler';

type PlacedStop = DeliveryStop & {position: LatLngPoint};

interface DeliveryMapCanvasProps {
  stops: DeliveryStop[];
  arrivalOffsets: number[];
  startDate: string;
  departureTime: string;
  elapsedMinutes: number;
  isSimulating: boolean;
  selectedStopIndex: number | null;
  routeOptions: RouteOption[];
  selectedRouteIndex: number;
  routeRefreshNonce: number;
  isVisible?: boolean;
  onSelectStop: (index: number | null) => void;
  onSelectRoute: (routeIndex: number) => void;
  onRoutesComputed: (routes: RouteOption[], recommendedIndex: number) => void;
}

function toLatLngPoint(pt: unknown): LatLngPoint | null {
  if (!pt || typeof pt !== 'object') return null;
  const candidate = pt as {
    lat?: number | (() => number);
    lng?: number | (() => number);
  };
  const lat =
    typeof candidate.lat === 'function' ? candidate.lat() : candidate.lat;
  const lng =
    typeof candidate.lng === 'function' ? candidate.lng() : candidate.lng;
  if (typeof lat === 'number' && typeof lng === 'number') {
    return {lat, lng};
  }
  return null;
}

function interpolateAlongPath(
  path: LatLngPoint[],
  fraction: number
): {position: LatLngPoint; heading: number} {
  if (path.length === 0) {
    return {position: {lat: 20, lng: 0}, heading: 0};
  }
  if (path.length === 1) {
    return {position: path[0], heading: 0};
  }

  const clamped = Math.max(0, Math.min(1, fraction));
  const segLengths: number[] = [];
  let totalLength = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const dLat = path[i + 1].lat - path[i].lat;
    const dLng = path[i + 1].lng - path[i].lng;
    const len = Math.hypot(dLat, dLng);
    segLengths.push(len);
    totalLength += len;
  }

  if (totalLength === 0) {
    return {position: path[0], heading: 0};
  }

  const targetDist = clamped * totalLength;
  let accumulated = 0;

  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (accumulated + segLen >= targetDist || i === segLengths.length - 1) {
      const localT = segLen > 0 ? (targetDist - accumulated) / segLen : 0;
      const start = path[i];
      const end = path[i + 1];
      const lat = start.lat + (end.lat - start.lat) * localT;
      const lng = start.lng + (end.lng - start.lng) * localT;
      const rad = Math.atan2(end.lng - start.lng, end.lat - start.lat);
      const heading = (rad * 180) / Math.PI;
      return {position: {lat, lng}, heading};
    }
    accumulated += segLen;
  }

  return {position: path[path.length - 1], heading: 0};
}

function StopMarkerWithInfo({
  stop,
  index,
  totalStops,
  arrivalMinutes,
  startDate,
  departureTime,
  status,
  isSelected,
  onClick,
  onClose,
}: {
  stop: PlacedStop;
  index: number;
  totalStops: number;
  arrivalMinutes: number;
  startDate: string;
  departureTime: string;
  status: 'arrived' | 'active' | 'scheduled';
  isSelected: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  const stopRole =
    index === 0
      ? 'Start'
      : index === totalStops - 1
        ? 'End'
        : `Stop ${index}`;

  const pinText =
    index === 0 ? 'S' : index === totalStops - 1 ? 'E' : String(index);

  const badgeColors =
    status === 'arrived'
      ? 'bg-purple-500 text-white border-purple-300/60'
      : status === 'active'
        ? 'bg-purple-700 text-white border-purple-400'
        : 'bg-[#0D0A14]/95 text-purple-100 border-purple-500/40';

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={stop.position}
        onClick={onClick}
        zIndex={isSelected ? 40 : status === 'active' ? 30 : 20}
        title={`${stopRole}: ${stop.label}`}
      >
        <div className="flex flex-col items-center cursor-pointer select-none group">
          <div
            className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold shadow-md border mb-1 whitespace-nowrap tabular-nums transition-transform ${
              isSelected ? 'scale-105 ring-2 ring-purple-400/60' : ''
            } ${badgeColors}`}
          >
            {stopRole} · {formatClockEta(departureTime, arrivalMinutes, startDate)}
          </div>
          <div
            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-mono font-bold shadow-lg transition-transform group-hover:scale-110 ${
              status === 'arrived'
                ? 'bg-purple-500 border-white text-white shadow-purple-500/50'
                : status === 'active'
                  ? 'bg-purple-600 border-purple-200 text-white shadow-purple-600/60'
                  : 'bg-[#0D0A14] border-purple-400/70 text-purple-100'
            }`}
          >
            {pinText}
          </div>
        </div>
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={260}>
          <div className="p-1.5 space-y-1.5 text-zinc-900">
            <div className="text-xs font-semibold">
              {stopRole}: {stop.label}
            </div>
            <div className="text-[11px] text-zinc-600 leading-snug">
              {stop.address}
            </div>
            <div className="pt-1.5 border-t border-zinc-200 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <div className="text-zinc-500">Estimated Arrival</div>
                <div className="font-mono font-semibold text-purple-700 tabular-nums">
                  {formatClockEta(departureTime, arrivalMinutes, startDate)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Total Travel Time</div>
                <div className="font-mono font-semibold text-zinc-900 tabular-nums">
                  {formatDurationLabel(arrivalMinutes)}
                </div>
              </div>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export function DeliveryMapCanvas({
  stops,
  arrivalOffsets,
  startDate,
  departureTime,
  elapsedMinutes,
  isSimulating,
  selectedStopIndex,
  routeOptions,
  selectedRouteIndex,
  routeRefreshNonce,
  isVisible = true,
  onSelectStop,
  onSelectRoute,
  onRoutesComputed,
}: DeliveryMapCanvasProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);

  const placedStops = useMemo(
    () =>
      stops
        .map((stop, originalIndex) => ({stop, originalIndex}))
        .filter(
          (entry): entry is {stop: PlacedStop; originalIndex: number} =>
            entry.stop.position !== null
        ),
    [stops]
  );

  const legCount = Math.max(0, placedStops.length - 1);

  const coordsSignature = placedStops
    .map(
      (entry) =>
        `${entry.stop.position.lat.toFixed(5)},${entry.stop.position.lng.toFixed(5)}`
    )
    .join('|');

  useEffect(() => {
    if (!map) return;

    if (placedStops.length === 0) {
      onRoutesComputed([], 0);
      setRouteNotice(null);
      return;
    }

    if (placedStops.length === 1) {
      onRoutesComputed([], 0);
      setRouteNotice(null);
      map.panTo(placedStops[0].stop.position);
      map.setZoom(13);
      return;
    }

    if (!routesLib) return;

    let cancelled = false;
    setIsLoadingRoute(true);
    setRouteNotice(null);

    const hasIntermediates = placedStops.length > 2;
    const departureDate = buildDepartureDate(startDate, departureTime);
    const isFutureDeparture = departureDate.getTime() > Date.now() + 60_000;

    const request: Record<string, unknown> = {
      origin: placedStops[0].stop.position,
      destination: placedStops[placedStops.length - 1].stop.position,
      intermediates: hasIntermediates
        ? placedStops
            .slice(1, -1)
            .map((entry) => ({location: entry.stop.position}))
        : [],
      travelMode: 'DRIVING',
      computeAlternativeRoutes: !hasIntermediates,
      fields: [
        'path',
        'distanceMeters',
        'durationMillis',
        'viewport',
        'legs',
        'description',
      ],
    };

    if (isFutureDeparture) {
      request.departureTime = departureDate;
      request.routingPreference = 'TRAFFIC_AWARE';
    }

    const routeClass = routesLib.Route as unknown as {
      computeRoutes: (req: unknown) => Promise<{
        routes?: Array<{
          description?: string;
          distanceMeters?: number;
          durationMillis?: number;
          legs?: Array<{
            path?: unknown[];
            durationMillis?: number;
            distanceMeters?: number;
          }>;
          viewport?: google.maps.LatLngBoundsLiteral | google.maps.LatLngBounds;
        }>;
      }>;
    };

    routeClass
      .computeRoutes(request)
      .then((res) => {
        if (cancelled) return;
        setIsLoadingRoute(false);

        const apiRoutes = res.routes ?? [];
        if (apiRoutes.length === 0) {
          setRouteNotice('No driving route returned; showing direct paths.');
          return;
        }

        const expectedLegs = placedStops.length - 1;
        const rawParsed = apiRoutes.map((route, rIdx) => {
          const legs: RouteLegGeometry[] = (route.legs ?? [])
            .slice(0, expectedLegs)
            .map((leg, idx) => {
              const rawPath = Array.isArray(leg.path) ? leg.path : [];
              const points = rawPath
                .map(toLatLngPoint)
                .filter((p): p is LatLngPoint => p !== null);

              const safePath =
                points.length >= 2
                  ? points
                  : [
                      placedStops[idx].stop.position,
                      placedStops[idx + 1].stop.position,
                    ];

              const durationMinutes = Math.max(
                1,
                Math.round((leg.durationMillis ?? 600000) / 60000)
              );

              return {
                fromStopIndex: placedStops[idx].originalIndex,
                toStopIndex: placedStops[idx + 1].originalIndex,
                path: safePath,
                durationMinutes,
                distanceMeters: leg.distanceMeters ?? 0,
              };
            });

          const totalDurationMinutes =
            route.durationMillis != null
              ? Math.max(1, Math.round(route.durationMillis / 60000))
              : legs.reduce((acc, l) => acc + l.durationMinutes, 0);

          const totalDistanceMeters =
            route.distanceMeters ??
            legs.reduce((acc, l) => acc + l.distanceMeters, 0);

          const cleanDescription = route.description?.trim();
          const summary = cleanDescription
            ? `via ${cleanDescription}`
            : `Route ${rIdx + 1}`;

          return {
            id: `route-${rIdx}`,
            index: rIdx,
            summary,
            totalDurationMinutes,
            totalDistanceMeters,
            legs,
            viewport: route.viewport ?? null,
          };
        });

        const {routes: scoredRoutes, recommendedIndex} =
          scoreAndTagRoutes(rawParsed);
        onRoutesComputed(scoredRoutes, recommendedIndex);

        const preferredViewport = scoredRoutes[recommendedIndex]?.viewport;
        if (preferredViewport) {
          map.fitBounds(preferredViewport, 56);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setIsLoadingRoute(false);
        const quotaHit = checkAndEmitQuotaError(err);
        setRouteNotice(
          quotaHit
            ? 'Google Maps quota reached; showing direct paths.'
            : 'Showing direct paths between selected locations.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    routesLib,
    map,
    coordsSignature,
    startDate,
    departureTime,
    routeRefreshNonce,
  ]);

  // Fallback direct paths if routeOptions hasn't arrived yet
  const fallbackLegs = useMemo<RouteLegGeometry[]>(() => {
    const legs: RouteLegGeometry[] = [];
    for (let i = 0; i < placedStops.length - 1; i++) {
      legs.push({
        fromStopIndex: i,
        toStopIndex: i + 1,
        path: [placedStops[i].stop.position, placedStops[i + 1].stop.position],
        durationMinutes: placedStops[i].stop.travelTimeMinutes || 10,
        distanceMeters: 0,
      });
    }
    return legs;
  }, [placedStops]);

  const activeRoute = routeOptions[selectedRouteIndex] ?? routeOptions[0];
  const activeLegs =
    activeRoute && activeRoute.legs.length === legCount
      ? activeRoute.legs
      : fallbackLegs;

  // Fit & zoom bounds onto the active route whenever route changes or map becomes visible
  useEffect(() => {
    if (!map || !isVisible) return;

    const rafId = requestAnimationFrame(() => {
      if (typeof google !== 'undefined' && google.maps?.event) {
        google.maps.event.trigger(map, 'resize');
      }

      if (activeRoute?.viewport) {
        map.fitBounds(activeRoute.viewport, 56);
        return;
      }

      if (
        typeof google !== 'undefined' &&
        google.maps?.LatLngBounds &&
        placedStops.length >= 2
      ) {
        const bounds = new google.maps.LatLngBounds();
        let hasPoint = false;
        activeLegs.forEach((leg) => {
          leg.path.forEach((pt) => {
            bounds.extend(pt);
            hasPoint = true;
          });
        });
        if (!hasPoint) {
          placedStops.forEach((entry) => bounds.extend(entry.stop.position));
        }
        map.fitBounds(bounds, 56);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [map, isVisible, selectedRouteIndex, activeRoute, activeLegs, placedStops]);

  const currentTransitLeg = useMemo(() => {
    if (legCount === 0 || elapsedMinutes <= 0) return 0;
    for (let i = 0; i < legCount; i++) {
      const nextStopOrigIdx = placedStops[i + 1]?.originalIndex ?? i + 1;
      if (elapsedMinutes < (arrivalOffsets[nextStopOrigIdx] ?? 0)) {
        return i;
      }
    }
    return legCount;
  }, [elapsedMinutes, arrivalOffsets, legCount, placedStops]);

  // Draw ALL returned routes simultaneously so user can see 1 or more routes on the map
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (placedStops.length < 2) return;

    const created: google.maps.Polyline[] = [];

    // 1. Draw unselected alternative routes first (clickable on map)
    routeOptions.forEach((routeOpt) => {
      if (routeOpt.index === selectedRouteIndex) return;
      routeOpt.legs.forEach((leg) => {
        const altLine = new google.maps.Polyline({
          path: leg.path,
          geodesic: true,
          strokeColor: '#6B21A8',
          strokeOpacity: 0.45,
          strokeWeight: 4,
          zIndex: 2,
          clickable: true,
          map,
        });
        altLine.addListener('click', () => {
          onSelectRoute(routeOpt.index);
        });
        created.push(altLine);
      });
    });

    // 2. Draw active/selected route on top with purple ambient glow
    activeLegs.forEach((leg, idx) => {
      const isCompleted = idx < currentTransitLeg;
      const isActive = idx === currentTransitLeg && currentTransitLeg < legCount;

      if (isActive || isCompleted) {
        const glowLine = new google.maps.Polyline({
          path: leg.path,
          geodesic: true,
          strokeColor: '#A855F7',
          strokeOpacity: isActive ? 0.38 : 0.22,
          strokeWeight: isActive ? 12 : 8,
          zIndex: 8,
          map,
        });
        created.push(glowLine);
      }

      const mainLine = new google.maps.Polyline({
        path: leg.path,
        geodesic: true,
        strokeColor: isCompleted
          ? '#D8B4FE'
          : isActive
            ? '#A855F7'
            : '#9333EA',
        strokeOpacity: 1,
        strokeWeight: isActive ? 6 : 5,
        zIndex: 10,
        map,
      });
      created.push(mainLine);
    });

    polylinesRef.current = created;

    return () => {
      created.forEach((p) => p.setMap(null));
    };
  }, [
    map,
    routeOptions,
    selectedRouteIndex,
    activeLegs,
    currentTransitLeg,
    legCount,
    placedStops.length,
    onSelectRoute,
  ]);

  // Animated courier vehicle position along the active driving leg
  const courierPose = useMemo(() => {
    if (placedStops.length < 2) return null;
    const lastOrigIdx = placedStops[placedStops.length - 1].originalIndex;
    if (elapsedMinutes <= 0) {
      return {position: placedStops[0].stop.position, heading: 0};
    }
    const maxArrival = arrivalOffsets[lastOrigIdx] ?? 0;
    if (elapsedMinutes >= maxArrival) {
      return {
        position: placedStops[placedStops.length - 1].stop.position,
        heading: 0,
      };
    }

    for (let i = 0; i < legCount; i++) {
      const startOrigIdx = placedStops[i].originalIndex;
      const endOrigIdx = placedStops[i + 1].originalIndex;
      const legStart = arrivalOffsets[startOrigIdx] ?? 0;
      const legEnd = arrivalOffsets[endOrigIdx] ?? 0;
      if (elapsedMinutes >= legStart && elapsedMinutes <= legEnd) {
        const legSpan = Math.max(0.001, legEnd - legStart);
        const fraction = (elapsedMinutes - legStart) / legSpan;
        return interpolateAlongPath(activeLegs[i]?.path ?? [], fraction);
      }
    }

    return {
      position: placedStops[placedStops.length - 1].stop.position,
      heading: 0,
    };
  }, [elapsedMinutes, arrivalOffsets, activeLegs, placedStops, legCount]);

  const activeLegDistance =
    currentTransitLeg < legCount
      ? formatDistanceKm(activeLegs[currentTransitLeg]?.distanceMeters)
      : '';

  const finalArrival =
    placedStops.length >= 2
      ? arrivalOffsets[placedStops[placedStops.length - 1].originalIndex] ?? 0
      : 0;

  return (
    <div className="relative w-full h-[460px] lg:h-[540px] rounded-2xl overflow-hidden border border-purple-500/25 bg-[#09070D]/90 shadow-2xl shadow-purple-950/30">
      <Map
        mapId="DEMO_MAP_ID"
        colorScheme="DARK"
        defaultCenter={{lat: 39.8283, lng: -98.5795}}
        defaultZoom={3}
        gestureHandling="greedy"
        disableDefaultUI={false}
        streetViewControl={false}
        mapTypeControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{width: '100%', height: '100%'}}
      >
        {placedStops.map(({stop, originalIndex}, idx) => {
          const arrival = arrivalOffsets[originalIndex] ?? 0;
          const arrived =
            placedStops.length >= 2 && elapsedMinutes >= arrival;
          const prevOrigIdx =
            idx > 0 ? placedStops[idx - 1].originalIndex : 0;
          const isNext =
            placedStops.length >= 2 &&
            !arrived &&
            idx > 0 &&
            elapsedMinutes >= (arrivalOffsets[prevOrigIdx] ?? 0) &&
            elapsedMinutes < arrival;
          const status = arrived ? 'arrived' : isNext ? 'active' : 'scheduled';

          return (
            <StopMarkerWithInfo
              key={stop.id}
              stop={stop}
              index={originalIndex}
              totalStops={stops.length}
              arrivalMinutes={arrival}
              startDate={startDate}
              departureTime={departureTime}
              status={status}
              isSelected={selectedStopIndex === originalIndex}
              onClick={() =>
                onSelectStop(
                  selectedStopIndex === originalIndex ? null : originalIndex
                )
              }
              onClose={() => onSelectStop(null)}
            />
          );
        })}

        {/* Animated Delivery Vehicle Marker */}
        {courierPose && (
          <AdvancedMarker
            position={courierPose.position}
            zIndex={50}
            title="Delivery Courier"
          >
            <div className="relative flex items-center justify-center">
              {isSimulating && (
                <span className="absolute w-11 h-11 rounded-full bg-purple-500/40 animate-ping" />
              )}
              <div
                className="w-8 h-8 rounded-full bg-purple-600 border-2 border-purple-100 shadow-lg shadow-purple-500/60 flex items-center justify-center text-white"
                style={{
                  transform: `rotate(${courierPose.heading}deg)`,
                }}
              >
                <Navigation className="w-4 h-4 fill-current" />
              </div>
            </div>
          </AdvancedMarker>
        )}
      </Map>

      {/* Bottom-left Live Journey Status Overlay */}
      <div className="absolute bottom-3 left-3 z-10 bg-black/85 backdrop-blur-md border border-purple-500/30 rounded-xl px-4 py-3 shadow-lg shadow-purple-950/50 max-w-sm space-y-1">
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-purple-100">
            {placedStops.length < 2
              ? 'Enter Start & Ending locations above to map your route'
              : activeRoute
                ? `${activeRoute.summary} · ${formatDurationLabel(activeRoute.totalDurationMinutes)} (${formatDistanceKm(activeRoute.totalDistanceMeters)})`
                : elapsedMinutes >= finalArrival && finalArrival > 0
                  ? 'Destination Reached'
                  : `Leg ${currentTransitLeg + 1} of ${legCount}`}
          </span>
          {isLoadingRoute && (
            <RefreshCw className="w-3.5 h-3.5 text-purple-400 animate-spin shrink-0" />
          )}
        </div>
        {placedStops.length >= 2 && (
          <div className="text-[11px] font-mono text-purple-300/80 tabular-nums">
            {routeOptions.length > 1
              ? `${routeOptions.length} routes shown on map · `
              : ''}
            Elapsed {elapsedMinutes.toFixed(0)} min
            {activeLegDistance ? ` · ${activeLegDistance}` : ''} · ETA{' '}
            {formatClockEta(departureTime, finalArrival, startDate)}
          </div>
        )}
        {routeNotice && (
          <div className="text-[11px] text-amber-300/90 pt-0.5">
            {routeNotice}
          </div>
        )}
      </div>
    </div>
  );
}
