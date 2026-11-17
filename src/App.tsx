import {useState, useEffect, useMemo, useCallback, useRef} from 'react';
import {APIProvider} from '@vis.gl/react-google-maps';
import {motion} from 'motion/react';
import {
  Play,
  Pause,
  RotateCcw,
  MapPin,
  Clock,
  Calendar,
  ArrowUpDown,
  Plus,
  Trash2,
  RefreshCw,
  Route,
  Sparkles,
  Check,
  Map as MapIcon,
} from 'lucide-react';
import {
  createEmptyStop,
  getTodayDateString,
  getCurrentTimeString,
  computeArrivalOffsets,
  formatClockEta,
  formatDistanceKm,
  formatDurationLabel,
} from './utils/routeTimes';
import type {
  DeliveryStop,
  LatLngPoint,
  RouteOption,
} from './types/delivery';
import {DeliveryMapCanvas} from './components/DeliveryMapCanvas';
import {StopAutocompleteInput} from './components/StopAutocompleteInput';

const MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || '';
const FLOWER_BG_SRC =
  '/src/assets/images/purple_flower_centerpiece_1794926303510.jpg';

type ActiveSection = 'planner' | 'map' | 'schedule';
type WorkspaceTab = 'map' | 'routes';

function formatShortDateLabel(dateStr: string): string {
  const todayStr = getTodayDateString();
  if (!dateStr || dateStr === todayStr) return 'Today';
  const [y, m, d] = dateStr.split('-').map((n) => Number.parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
}

export default function App() {
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [activeNav, setActiveNav] = useState<ActiveSection>('planner');
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('map');
  const [flowerBgError, setFlowerBgError] = useState(false);

  const [stops, setStops] = useState<DeliveryStop[]>(() => [
    createEmptyStop(1),
    createEmptyStop(2),
  ]);
  const [startDate, setStartDate] = useState<string>(() => getTodayDateString());
  const [departureTime, setDepartureTime] = useState<string>(() =>
    getCurrentTimeString()
  );
  const [isSchedulePickerOpen, setIsSchedulePickerOpen] = useState(false);
  const schedulePickerRef = useRef<HTMLDivElement>(null);

  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [routeRefreshNonce, setRouteRefreshNonce] = useState(0);

  // Delivery animation playback state
  const [isSimulating, setIsSimulating] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(4);
  const [elapsedMinutes, setElapsedMinutes] = useState<number>(0);
  const [selectedStopIndex, setSelectedStopIndex] = useState<number | null>(
    null
  );

  // Listen for Google Maps quota exceeded event
  useEffect(() => {
    const handler = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  // Close inline start date/time picker on outside click
  useEffect(() => {
    if (!isSchedulePickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        schedulePickerRef.current &&
        !schedulePickerRef.current.contains(event.target as Node)
      ) {
        setIsSchedulePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSchedulePickerOpen]);

  const placedCount = useMemo(
    () => stops.filter((s) => s.position !== null).length,
    [stops]
  );
  const hasCompleteEndpoints =
    stops[0]?.position !== null && stops[stops.length - 1]?.position !== null;

  // Calculate cumulative arrival time before reaching each stop
  const segmentDurations = useMemo(
    () => stops.map((s) => s.travelTimeMinutes),
    [stops]
  );

  const arrivalOffsets = useMemo(
    () => computeArrivalOffsets(segmentDurations),
    [segmentDurations]
  );

  const lastIndex = stops.length - 1;
  const finalStopArrivalMinutes = arrivalOffsets[lastIndex] ?? 0;

  const activeRoute =
    routeOptions[selectedRouteIndex] ?? routeOptions[0] ?? null;

  const totalRouteDistanceMeters = useMemo(() => {
    if (activeRoute && activeRoute.totalDistanceMeters > 0) {
      return activeRoute.totalDistanceMeters;
    }
    return stops.reduce((acc, s) => acc + (s.distanceMeters ?? 0), 0);
  }, [activeRoute, stops]);

  // Smooth requestAnimationFrame delivery route animation
  useEffect(() => {
    if (!isSimulating || finalStopArrivalMinutes <= 0) return;
    let lastTimestamp = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const dtSeconds = (now - lastTimestamp) / 1000;
      lastTimestamp = now;
      const deltaMinutes = dtSeconds * 2 * playbackSpeed;

      setElapsedMinutes((prev) => {
        const next = prev + deltaMinutes;
        if (next >= finalStopArrivalMinutes) {
          setIsSimulating(false);
          return finalStopArrivalMinutes;
        }
        return next;
      });

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isSimulating, playbackSpeed, finalStopArrivalMinutes]);

  const handleToggleSimulation = () => {
    if (!hasCompleteEndpoints || finalStopArrivalMinutes <= 0) return;
    if (isSimulating) {
      setIsSimulating(false);
      return;
    }
    if (elapsedMinutes >= finalStopArrivalMinutes) {
      setElapsedMinutes(0);
    }
    setIsSimulating(true);
  };

  const handleResetSimulation = () => {
    setIsSimulating(false);
    setElapsedMinutes(0);
    setSelectedStopIndex(null);
  };

  const syncStopsToRoute = useCallback(
    (routes: RouteOption[], routeIndex: number) => {
      const chosen = routes[routeIndex];
      if (!chosen) return;
      setSelectedRouteIndex(routeIndex);
      setIsSimulating(false);
      setElapsedMinutes(0);
      setStops((prev) =>
        prev.map((stop, idx) => {
          const matchingLeg = chosen.legs.find(
            (leg) => leg.fromStopIndex === idx
          );
          if (matchingLeg) {
            return {
              ...stop,
              travelTimeMinutes: matchingLeg.durationMinutes,
              distanceMeters: matchingLeg.distanceMeters,
            };
          }
          return idx === prev.length - 1
            ? {...stop, travelTimeMinutes: 0, distanceMeters: undefined}
            : stop;
        })
      );
    },
    []
  );

  const handleRoutesComputed = useCallback(
    (routes: RouteOption[], recommendedIndex: number) => {
      setRouteOptions(routes);
      if (routes.length === 0) {
        setSelectedRouteIndex(0);
        return;
      }
      const safeIndex = routes[recommendedIndex] ? recommendedIndex : 0;
      syncStopsToRoute(routes, safeIndex);
    },
    [syncStopsToRoute]
  );

  const handleSelectRoute = useCallback(
    (routeIndex: number) => {
      syncStopsToRoute(routeOptions, routeIndex);
      setWorkspaceTab('map');
    },
    [routeOptions, syncStopsToRoute]
  );

  const handlePlaceSelect = (
    index: number,
    place: {label: string; address: string; position: LatLngPoint}
  ) => {
    setStops((prev) =>
      prev.map((s, idx) =>
        idx === index
          ? {
              ...s,
              label: place.label,
              address: place.address,
              position: place.position,
            }
          : s
      )
    );
    setSelectedStopIndex(index);
    setIsSimulating(false);
    setElapsedMinutes(0);
  };

  const handleClearPlace = (index: number) => {
    setStops((prev) =>
      prev.map((s, idx) =>
        idx === index
          ? {
              ...s,
              label: '',
              address: '',
              position: null,
              travelTimeMinutes: 0,
              distanceMeters: undefined,
            }
          : s
      )
    );
    setRouteOptions([]);
    setSelectedRouteIndex(0);
    setIsSimulating(false);
    setElapsedMinutes(0);
  };

  const handleSwapStops = () => {
    if (stops.length < 2) return;
    setStops((prev) => [...prev].reverse());
    setIsSimulating(false);
    setElapsedMinutes(0);
    setSelectedStopIndex(null);
  };

  const handleAddExtraStop = () => {
    if (stops.length >= 6) return;
    setStops((prev) => [
      ...prev.slice(0, -1),
      createEmptyStop(Date.now()),
      prev[prev.length - 1],
    ]);
    setIsSimulating(false);
    setElapsedMinutes(0);
  };

  const handleRemoveExtraStop = (index: number) => {
    if (stops.length <= 2 || index === 0 || index === stops.length - 1) return;
    setStops((prev) => prev.filter((_, idx) => idx !== index));
    setSelectedStopIndex(null);
    setIsSimulating(false);
    setElapsedMinutes(0);
  };

  const handleResetAllLocations = () => {
    setStops([createEmptyStop(Date.now()), createEmptyStop(Date.now() + 1)]);
    setRouteOptions([]);
    setSelectedRouteIndex(0);
    setIsSimulating(false);
    setElapsedMinutes(0);
    setSelectedStopIndex(null);
  };

  const handleTravelMinutesChange = (index: number, value: number) => {
    const safeMinutes = Math.max(1, Math.min(360, Math.round(value || 1)));
    setStops((prev) =>
      prev.map((s, idx) =>
        idx === index ? {...s, travelTimeMinutes: safeMinutes} : s
      )
    );
  };

  const scrollToSection = (section: ActiveSection, id: string) => {
    setActiveNav(section);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
  };

  return (
    <div className="min-h-screen bg-[#050408] text-zinc-100 flex flex-col relative overflow-x-hidden">
      {/* Centered Purple Flower Full-Website Background with Purple Ambient Lighting */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden"
      >
        <motion.div
          animate={{scale: [1, 1.04, 1], opacity: [0.45, 0.65, 0.45]}}
          transition={{duration: 7, repeat: Infinity, ease: 'easeInOut'}}
          className="absolute w-[620px] h-[620px] sm:w-[820px] sm:h-[820px] rounded-full bg-purple-700/25 blur-3xl"
        />
        {!flowerBgError && (
          <img
            src={FLOWER_BG_SRC}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setFlowerBgError(true)}
            className="w-[540px] h-[540px] sm:w-[760px] sm:h-[760px] lg:w-[880px] lg:h-[880px] object-contain opacity-40 select-none"
            style={{
              maskImage:
                'radial-gradient(circle, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 74%)',
              WebkitMaskImage:
                'radial-gradient(circle, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 74%)',
            }}
          />
        )}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_15%,rgba(5,4,8,0.82)_75%,rgba(5,4,8,0.96)_100%)]" />
      </div>

      {/* Google Maps Quota Banner (when triggered) */}
      {quotaExceeded && (
        <div className="bg-amber-950/90 border-b border-amber-500/40 text-amber-100 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 backdrop-blur-md">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-200 hover:text-white"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Top Bar: Clean 3-Zone Contract */}
      <header className="sticky top-0 z-30 bg-black/75 backdrop-blur-md border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-base sm:text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Delivery Arrival Time Estimator
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
            <button
              type="button"
              onClick={() => scrollToSection('planner', 'section-planner')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeNav === 'planner'
                  ? 'border-purple-500 text-white'
                  : 'border-transparent hover:text-purple-200'
              }`}
            >
              Route Planner
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('map', 'section-map')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeNav === 'map'
                  ? 'border-purple-500 text-white'
                  : 'border-transparent hover:text-purple-200'
              }`}
            >
              Route Map
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('schedule', 'section-schedule')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeNav === 'schedule'
                  ? 'border-purple-500 text-white'
                  : 'border-transparent hover:text-purple-200'
              }`}
            >
              Arrival Schedule
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleToggleSimulation}
              disabled={!hasCompleteEndpoints || finalStopArrivalMinutes <= 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-45 disabled:cursor-not-allowed shadow-lg shadow-purple-700/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isSimulating ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Pause Delivery
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Start Delivery
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main
        id="top"
        className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8"
      >
        {/* Hero Header */}
        <section className="flex flex-col items-center text-center space-y-3 pt-2">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight text-balance max-w-2xl">
            Plan your delivery route from start to destination
          </h1>
          <p className="text-sm sm:text-base text-zinc-300/90 leading-relaxed max-w-xl">
            Compare available routes by travel time and distance, optionally set
            your departure date and time, and track estimated arrivals.
          </p>
        </section>

        <APIProvider
          apiKey={MAPS_API_KEY}
          libraries={['places', 'routes', 'marker']}
          language="en"
          region="US"
        >
          {/* Rectangular Route Location Dialogue Box */}
          <section
            id="section-planner"
            className="max-w-5xl mx-auto w-full bg-[#0B0812]/85 backdrop-blur-md border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-950/40 space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-purple-500/20">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Route Location Dialogue Box
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Enter your start location, ending location, and any extra
                  stops to view routes and arrival times.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSwapStops}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-purple-200 bg-purple-950/60 border border-purple-500/35 rounded-lg hover:bg-purple-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  Swap Stops
                </button>
                {stops.length < 6 && (
                  <button
                    type="button"
                    onClick={handleAddExtraStop}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-purple-100 bg-purple-600/25 border border-purple-500/40 rounded-lg hover:bg-purple-600/40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Extra Stop
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResetAllLocations}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-300 bg-white/5 border border-purple-500/20 rounded-lg hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear
                </button>
              </div>
            </div>

            {/* Location Inputs Inside the Rectangular Box */}
            <div className="space-y-4">
              {stops.map((stop, idx) => {
                const isStart = idx === 0;
                const isEnd = idx === lastIndex;
                const fieldLabel = isStart
                  ? 'Start Location'
                  : isEnd
                    ? 'Ending Location'
                    : `Extra Stop ${idx}`;
                const placeholder = isStart
                  ? 'Enter starting address, city, or landmark...'
                  : isEnd
                    ? 'Enter ending address, city, or landmark...'
                    : `Enter extra stop ${idx} address or landmark...`;

                return (
                  <div
                    key={stop.id}
                    className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start"
                  >
                    <div className="md:col-span-3 flex items-center gap-2.5 pt-2">
                      <span
                        className={`w-6 h-6 rounded-full text-xs font-mono font-bold flex items-center justify-center shrink-0 ${
                          isStart
                            ? 'bg-purple-500 text-white'
                            : isEnd
                              ? 'bg-purple-700 text-white'
                              : 'bg-zinc-900 border border-purple-500/40 text-purple-200'
                        }`}
                      >
                        {isStart ? 'S' : isEnd ? 'E' : idx}
                      </span>
                      <label
                        htmlFor={`route-input-${stop.id}`}
                        className="text-xs font-medium text-purple-200"
                      >
                        {fieldLabel}
                      </label>
                    </div>

                    {isStart ? (
                      <div className="md:col-span-9 flex flex-col sm:flex-row items-stretch sm:items-start gap-2.5">
                        <div className="flex-1 min-w-0">
                          <StopAutocompleteInput
                            inputId={`route-input-${stop.id}`}
                            placeholder={placeholder}
                            selectedLabel={stop.label}
                            selectedAddress={stop.address}
                            onSelectPlace={(place) =>
                              handlePlaceSelect(idx, place)
                            }
                            onClearPlace={() => handleClearPlace(idx)}
                          />
                        </div>

                        {/* Start Date & Start Time button directly next to Start Location */}
                        <div
                          ref={schedulePickerRef}
                          className="relative shrink-0"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setIsSchedulePickerOpen((open) => !open)
                            }
                            aria-expanded={isSchedulePickerOpen}
                            title="Optional: choose start date and start time (defaults to today)"
                            className={`h-10 px-3.5 inline-flex items-center justify-center gap-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer w-full sm:w-auto ${
                              isSchedulePickerOpen
                                ? 'bg-purple-600/30 border-purple-400 text-white'
                                : 'bg-black/75 border-purple-500/35 text-purple-100 hover:border-purple-400 hover:bg-purple-950/50'
                            }`}
                          >
                            <Calendar className="w-3.5 h-3.5 text-purple-300 shrink-0" />
                            <span className="font-mono tabular-nums">
                              {formatShortDateLabel(startDate)} ·{' '}
                              {formatClockEta(departureTime, 0, startDate).replace(
                                /^[^,]+,\s*/,
                                ''
                              )}
                            </span>
                            <Clock className="w-3.5 h-3.5 text-purple-300 shrink-0" />
                          </button>

                          {isSchedulePickerOpen && (
                            <div className="sm:absolute sm:right-0 mt-2 w-full sm:w-72 bg-[#0D0A14] border border-purple-500/40 rounded-xl p-4 shadow-2xl shadow-purple-950/80 z-40 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-white">
                                  Start Date &amp; Time
                                </span>
                                <span className="text-[11px] text-zinc-400">
                                  Optional
                                </span>
                              </div>

                              <div className="space-y-2.5">
                                <label className="block space-y-1">
                                  <span className="text-[11px] text-zinc-400">
                                    Start Date (default: today)
                                  </span>
                                  <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) =>
                                      setStartDate(
                                        e.target.value || getTodayDateString()
                                      )
                                    }
                                    className="w-full h-9 px-2.5 text-xs font-mono text-white bg-black/80 border border-purple-500/30 rounded-lg focus:outline-none focus:border-purple-400 [color-scheme:dark]"
                                  />
                                </label>

                                <label className="block space-y-1">
                                  <span className="text-[11px] text-zinc-400">
                                    Start Time
                                  </span>
                                  <input
                                    type="time"
                                    value={departureTime}
                                    onChange={(e) =>
                                      setDepartureTime(
                                        e.target.value || '09:00'
                                      )
                                    }
                                    className="w-full h-9 px-2.5 text-xs font-mono text-white bg-black/80 border border-purple-500/30 rounded-lg focus:outline-none focus:border-purple-400 [color-scheme:dark]"
                                  />
                                </label>
                              </div>

                              <div className="pt-2 border-t border-purple-500/20 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setStartDate(getTodayDateString());
                                    setDepartureTime(getCurrentTimeString());
                                  }}
                                  className="px-2.5 py-1.5 text-[11px] font-medium text-purple-200 hover:text-white bg-purple-950/60 border border-purple-500/30 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  Reset to Today &amp; Now
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setIsSchedulePickerOpen(false)}
                                  className="px-3 py-1.5 text-[11px] font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  Done
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="md:col-span-8">
                          <StopAutocompleteInput
                            inputId={`route-input-${stop.id}`}
                            placeholder={placeholder}
                            selectedLabel={stop.label}
                            selectedAddress={stop.address}
                            onSelectPlace={(place) =>
                              handlePlaceSelect(idx, place)
                            }
                            onClearPlace={() => handleClearPlace(idx)}
                          />
                        </div>

                        <div className="md:col-span-1 flex justify-end pt-1">
                          {!isEnd && (
                            <button
                              type="button"
                              onClick={() => handleRemoveExtraStop(idx)}
                              title={`Remove ${fieldLabel}`}
                              aria-label={`Remove ${fieldLabel}`}
                              className="p-2 text-zinc-400 hover:text-red-300 hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Box Footer: Status + Refresh Map & Schedule CTA */}
            <div className="pt-4 border-t border-purple-500/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                <span>
                  {placedCount} of {stops.length} locations selected
                </span>
                <span aria-hidden="true" className="text-purple-500/40">
                  ·
                </span>
                <span className="font-mono text-purple-200/90 tabular-nums">
                  Departs {formatClockEta(departureTime, 0, startDate)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setRouteRefreshNonce((n) => n + 1);
                  scrollToSection('map', 'section-map');
                }}
                disabled={!hasCompleteEndpoints}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-45 disabled:cursor-not-allowed shadow-lg shadow-purple-700/35 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Update Map &amp; Schedule
              </button>
            </div>
          </section>

          {/* Summary KPI Strip */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#0B0812]/80 backdrop-blur-md border border-purple-500/20 rounded-xl p-4">
              <div className="text-xs text-zinc-400">Start Location</div>
              <div className="mt-1 text-sm sm:text-base font-semibold text-white truncate">
                {stops[0]?.label || 'Not selected'}
              </div>
              <div className="text-xs font-mono text-purple-300 tabular-nums mt-0.5">
                Departs {formatClockEta(departureTime, 0, startDate)}
              </div>
            </div>

            <div className="bg-[#0B0812]/80 backdrop-blur-md border border-purple-500/20 rounded-xl p-4">
              <div className="text-xs text-zinc-400">Ending Location</div>
              <div className="mt-1 text-sm sm:text-base font-semibold text-white truncate">
                {stops[lastIndex]?.label || 'Not selected'}
              </div>
              <div className="text-xs font-mono text-purple-300 tabular-nums mt-0.5">
                {hasCompleteEndpoints
                  ? `Arrives ${formatClockEta(departureTime, finalStopArrivalMinutes, startDate)}`
                  : 'Waiting for route'}
              </div>
            </div>

            <div className="bg-[#0B0812]/80 backdrop-blur-md border border-purple-500/20 rounded-xl p-4">
              <div className="text-xs text-zinc-400">
                Selected Route Time &amp; Distance
              </div>
              <div className="mt-1 text-lg font-mono font-semibold text-purple-300 tabular-nums">
                {hasCompleteEndpoints
                  ? formatDurationLabel(finalStopArrivalMinutes)
                  : '—'}
              </div>
              <div className="text-xs text-zinc-400 mt-0.5 tabular-nums">
                {hasCompleteEndpoints && totalRouteDistanceMeters > 0
                  ? `${formatDistanceKm(totalRouteDistanceMeters)} · ${
                      stops.length === 2
                        ? 'Direct route'
                        : `${stops.length} stops`
                    }`
                  : stops.length === 2
                    ? 'Direct route'
                    : `${stops.length} stops (${stops.length - 1} legs)`}
              </div>
            </div>

            <div className="bg-[#0B0812]/80 backdrop-blur-md border border-purple-500/20 rounded-xl p-4">
              <div className="text-xs text-zinc-400">Journey Progress</div>
              <div className="mt-1 text-lg font-mono font-semibold text-white tabular-nums">
                {hasCompleteEndpoints && finalStopArrivalMinutes > 0
                  ? `${Math.min(100, Math.round((elapsedMinutes / finalStopArrivalMinutes) * 100))}%`
                  : '0%'}
              </div>
              <div className="text-xs text-zinc-400 mt-0.5 tabular-nums">
                {elapsedMinutes.toFixed(0)} / {finalStopArrivalMinutes} min
                elapsed
              </div>
            </div>
          </section>

          {/* Route Workspace with Separate Tabs: Route Map vs Route Options */}
          <section id="section-map" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div
                role="tablist"
                aria-label="Route workspace views"
                className="inline-flex items-center gap-1 p-1 bg-[#0B0812]/90 border border-purple-500/25 rounded-xl w-fit"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'map'}
                  onClick={() => setWorkspaceTab('map')}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    workspaceTab === 'map'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-700/30'
                      : 'text-zinc-300 hover:text-white hover:bg-purple-950/40'
                  }`}
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  Route Map
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workspaceTab === 'routes'}
                  onClick={() => setWorkspaceTab('routes')}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    workspaceTab === 'routes'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-700/30'
                      : 'text-zinc-300 hover:text-white hover:bg-purple-950/40'
                  }`}
                >
                  <Route className="w-3.5 h-3.5" />
                  Route Options
                  {routeOptions.length > 0 && (
                    <span className="font-mono text-[11px] opacity-90 tabular-nums">
                      ({routeOptions.length})
                    </span>
                  )}
                </button>
              </div>

              {activeRoute && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                  <span className="font-medium text-purple-200">
                    Active: {activeRoute.summary}
                  </span>
                  <span className="text-purple-500/50">·</span>
                  <span className="font-mono tabular-nums text-white">
                    {formatDurationLabel(activeRoute.totalDurationMinutes)}
                  </span>
                  {activeRoute.totalDistanceMeters > 0 && (
                    <>
                      <span className="text-purple-500/50">·</span>
                      <span className="font-mono tabular-nums text-zinc-300">
                        {formatDistanceKm(activeRoute.totalDistanceMeters)}
                      </span>
                    </>
                  )}
                  {activeRoute.isRecommended && (
                    <>
                      <span className="text-purple-500/50">·</span>
                      <span className="inline-flex items-center gap-1 text-purple-300 font-medium">
                        <Sparkles className="w-3 h-3" />
                        Recommended
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Keep DeliveryMapCanvas mounted across tab switches so Google Maps does not re-query */}
            <div className={workspaceTab === 'map' ? 'block' : 'hidden'}>
              {MAPS_API_KEY ? (
                <DeliveryMapCanvas
                  stops={stops}
                  arrivalOffsets={arrivalOffsets}
                  startDate={startDate}
                  departureTime={departureTime}
                  elapsedMinutes={elapsedMinutes}
                  isSimulating={isSimulating}
                  selectedStopIndex={selectedStopIndex}
                  routeOptions={routeOptions}
                  selectedRouteIndex={selectedRouteIndex}
                  routeRefreshNonce={routeRefreshNonce}
                  isVisible={workspaceTab === 'map'}
                  onSelectStop={setSelectedStopIndex}
                  onSelectRoute={handleSelectRoute}
                  onRoutesComputed={handleRoutesComputed}
                />
              ) : (
                <div className="w-full h-[460px] lg:h-[540px] rounded-2xl border border-purple-500/25 bg-[#0B0812]/85 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center space-y-3">
                  <MapPin className="w-8 h-8 text-purple-400" />
                  <h3 className="text-base font-semibold text-white">
                    Google Maps Unavailable
                  </h3>
                  <p className="text-sm text-zinc-400 max-w-md">
                    A Google Maps API key is required to display live routes and
                    place search.
                  </p>
                </div>
              )}
            </div>

            {/* Separate Route Options Tab */}
            {workspaceTab === 'routes' && (
              <div className="bg-[#0B0812]/85 backdrop-blur-md border border-purple-500/25 rounded-2xl p-6 space-y-5 min-h-[460px]">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-purple-500/20">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Available Routes &amp; Recommendation
                    </h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      We recommend the route that balances the shortest travel
                      time and distance. Select any route to update the map and
                      arrival schedule.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab('map')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-purple-200 bg-purple-950/60 border border-purple-500/35 rounded-lg hover:bg-purple-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    Back to Map
                  </button>
                </div>

                {!hasCompleteEndpoints || routeOptions.length === 0 ? (
                  <div className="py-16 text-center space-y-2">
                    <Route className="w-8 h-8 text-purple-400/70 mx-auto" />
                    <p className="text-sm font-medium text-zinc-200">
                      No routes available yet
                    </p>
                    <p className="text-xs text-zinc-400 max-w-md mx-auto">
                      Enter both a Start Location and an Ending Location above
                      to compare available routes by time and distance.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {routeOptions.map((routeOpt) => {
                        const isSelected =
                          routeOpt.index === selectedRouteIndex;
                        const etaText = formatClockEta(
                          departureTime,
                          routeOpt.totalDurationMinutes,
                          startDate
                        );

                        return (
                          <div
                            key={routeOpt.id}
                            className={`rounded-xl border p-5 flex flex-col justify-between gap-4 transition-colors ${
                              isSelected
                                ? 'bg-purple-950/45 border-purple-400 shadow-lg shadow-purple-950/50'
                                : 'bg-black/60 border-purple-500/20 hover:border-purple-500/45'
                            }`}
                          >
                            <div className="space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1">
                                  <div className="text-xs font-mono text-zinc-400">
                                    Option {routeOpt.index + 1}
                                  </div>
                                  <h3 className="text-base font-semibold text-white leading-snug">
                                    {routeOpt.summary}
                                  </h3>
                                </div>
                                {isSelected && (
                                  <span className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0">
                                    <Check className="w-3.5 h-3.5" />
                                  </span>
                                )}
                              </div>

                              {/* Clean unboxed recommendation metadata */}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                {routeOpt.isRecommended && (
                                  <span className="inline-flex items-center gap-1 font-semibold text-purple-300">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Recommended · Less time &amp; distance
                                  </span>
                                )}
                                {!routeOpt.isRecommended &&
                                  routeOpt.isFastest && (
                                    <span className="font-medium text-purple-300">
                                      Fastest travel time
                                    </span>
                                  )}
                                {!routeOpt.isRecommended &&
                                  !routeOpt.isFastest &&
                                  routeOpt.isShortest && (
                                    <span className="font-medium text-purple-300">
                                      Shortest distance
                                    </span>
                                  )}
                              </div>

                              <div className="pt-3 border-t border-purple-500/15 grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <div className="text-zinc-400">Time</div>
                                  <div className="mt-0.5 font-mono font-semibold text-white tabular-nums">
                                    {formatDurationLabel(
                                      routeOpt.totalDurationMinutes
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-zinc-400">Distance</div>
                                  <div className="mt-0.5 font-mono font-semibold text-purple-200 tabular-nums">
                                    {formatDistanceKm(
                                      routeOpt.totalDistanceMeters
                                    ) || '—'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-zinc-400">Arrival</div>
                                  <div className="mt-0.5 font-mono font-semibold text-white tabular-nums">
                                    {etaText}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="pt-2">
                              <button
                                type="button"
                                onClick={() => handleSelectRoute(routeOpt.index)}
                                className={`w-full py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                  isSelected
                                    ? 'bg-purple-600 text-white hover:bg-purple-500'
                                    : 'bg-purple-950/70 text-purple-200 border border-purple-500/35 hover:bg-purple-600 hover:text-white'
                                }`}
                              >
                                {isSelected
                                  ? 'Active Route · View on Map'
                                  : 'Choose Route & View Map'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {stops.length > 2 && (
                      <p className="text-xs text-zinc-400 pt-1">
                        Alternative routes are provided when navigating directly
                        from Start Location to Ending Location. When extra stops
                        are added, Google Maps calculates a single unified
                        multi-stop route.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Smooth Route Playback Controls */}
            <div className="bg-[#0B0812]/80 backdrop-blur-md border border-purple-500/20 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleSimulation}
                    disabled={
                      !hasCompleteEndpoints || finalStopArrivalMinutes <= 0
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isSimulating ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        Pause Journey
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        Animate Route
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetSimulation}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-300 bg-white/5 border border-purple-500/20 rounded-lg hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </div>

                <div className="flex items-center gap-1 bg-black/60 border border-purple-500/20 p-1 rounded-lg">
                  {[1, 2, 4].map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => setPlaybackSpeed(spd)}
                      className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors cursor-pointer ${
                        playbackSpeed === spd
                          ? 'bg-purple-600 text-white font-semibold'
                          : 'text-zinc-400 hover:text-purple-200'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Timeline Scrubber with Stop Milestones */}
              <div className="space-y-1.5">
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, finalStopArrivalMinutes)}
                  step={0.5}
                  disabled={!hasCompleteEndpoints}
                  value={elapsedMinutes}
                  onChange={(e) => {
                    setIsSimulating(false);
                    setElapsedMinutes(Number(e.target.value));
                  }}
                  aria-label="Route journey timeline"
                  className="w-full accent-purple-500 cursor-pointer disabled:opacity-45"
                />
                {hasCompleteEndpoints && (
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 tabular-nums">
                    {arrivalOffsets.map((arrival, i) => {
                      const label =
                        i === 0
                          ? 'Start'
                          : i === lastIndex
                            ? 'End'
                            : `Stop ${i}`;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setIsSimulating(false);
                            setElapsedMinutes(arrival);
                            setSelectedStopIndex(i);
                          }}
                          className={`hover:text-purple-300 transition-colors cursor-pointer ${
                            elapsedMinutes >= arrival
                              ? 'text-purple-300 font-semibold'
                              : ''
                          }`}
                        >
                          {label}:{' '}
                          {formatClockEta(departureTime, arrival, startDate)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        </APIProvider>

        {/* Estimated Arrival Schedule Table */}
        <section
          id="section-schedule"
          className="bg-[#0B0812]/80 backdrop-blur-md border border-purple-500/20 rounded-2xl overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-purple-500/15 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Estimated Arrival Schedule
              </h2>
              <p className="text-sm text-zinc-400">
                Automatically updates based on your selected route, departure
                date and time, and stops.
              </p>
            </div>
            <div className="text-xs font-mono text-purple-300 tabular-nums">
              Starts {formatClockEta(departureTime, 0, startDate)}
            </div>
          </div>

          {!hasCompleteEndpoints ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-medium text-zinc-200">
                No route calculated yet
              </p>
              <p className="text-xs text-zinc-400">
                Select both a Start Location and an Ending Location in the Route
                Location Dialogue Box above to generate your arrival schedule.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-purple-500/15 bg-black/40 text-xs font-medium text-zinc-400">
                    <th className="py-3 px-4">Stop</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4 text-right">Distance</th>
                    <th className="py-3 px-4 text-right">Drive to Next</th>
                    <th className="py-3 px-4 text-right">
                      Time Until Arrival
                    </th>
                    <th className="py-3 px-4 text-right">Estimated Arrival</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-500/10 text-sm">
                  {stops.map((stop, idx) => {
                    const isStart = idx === 0;
                    const isEnd = idx === lastIndex;
                    const roleLabel = isStart
                      ? 'Start'
                      : isEnd
                        ? 'Destination'
                        : `Extra Stop ${idx}`;
                    const arrival = arrivalOffsets[idx] ?? 0;
                    const isArrived = elapsedMinutes >= arrival;
                    const isEnRoute =
                      !isArrived &&
                      idx > 0 &&
                      elapsedMinutes >= (arrivalOffsets[idx - 1] ?? 0);

                    return (
                      <tr
                        key={stop.id}
                        onClick={() => setSelectedStopIndex(idx)}
                        className={`transition-colors cursor-pointer ${
                          selectedStopIndex === idx
                            ? 'bg-purple-900/25'
                            : 'hover:bg-purple-950/20'
                        }`}
                      >
                        <td className="py-3.5 px-4 font-mono text-xs font-semibold text-purple-300 tabular-nums">
                          {roleLabel}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-white">
                            {stop.label || 'Not selected'}
                          </div>
                          <div className="text-xs text-zinc-400 truncate max-w-sm">
                            {stop.address || 'Select a location above'}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-xs text-zinc-300 tabular-nums">
                          {!isEnd
                            ? formatDistanceKm(stop.distanceMeters) || '—'
                            : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {!isEnd ? (
                            <div className="inline-flex items-center justify-end gap-1">
                              <input
                                type="number"
                                min={1}
                                max={360}
                                aria-label={`Drive minutes from ${roleLabel} to next stop`}
                                value={stop.travelTimeMinutes || 1}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  handleTravelMinutesChange(
                                    idx,
                                    Number(e.target.value)
                                  )
                                }
                                className="w-14 h-7 px-2 text-right font-mono text-xs font-semibold text-white bg-black/70 border border-purple-500/25 rounded-md focus:outline-none focus:border-purple-400 tabular-nums"
                              />
                              <span className="text-xs text-zinc-400">min</span>
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-400">
                              Final stop
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-purple-300 tabular-nums">
                          {formatDurationLabel(arrival)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-semibold text-white tabular-nums">
                          {formatClockEta(departureTime, arrival, startDate)}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-medium">
                          <span
                            className={
                              isArrived
                                ? 'text-purple-300'
                                : isEnRoute
                                  ? 'text-fuchsia-300'
                                  : 'text-zinc-500'
                            }
                          >
                            {isArrived
                              ? 'Reached'
                              : isEnRoute
                                ? 'On the way'
                                : 'Scheduled'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <footer className="relative z-10 border-t border-purple-500/15 bg-black/75 backdrop-blur-md mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500">
          <span>Delivery Arrival Time Estimator</span>
          <span>Routes and places powered by Google Maps</span>
        </div>
      </footer>
    </div>
  );
}
