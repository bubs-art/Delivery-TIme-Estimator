import {useState, useRef, useEffect} from 'react';
import {useMapsLibrary} from '@vis.gl/react-google-maps';
import {Search, MapPin, Loader2, X} from 'lucide-react';
import {useAutocompleteSuggestions} from '../hooks/useAutocompleteSuggestions';
import {checkAndEmitQuotaError} from '../utils/quotaHandler';
import type {LatLngPoint} from '../types/delivery';

interface StopAutocompleteInputProps {
  inputId: string;
  placeholder: string;
  selectedLabel: string;
  selectedAddress: string;
  onSelectPlace: (place: {
    label: string;
    address: string;
    position: LatLngPoint;
  }) => void;
  onClearPlace?: () => void;
}

export function StopAutocompleteInput({
  inputId,
  placeholder,
  selectedLabel,
  selectedAddress,
  onSelectPlace,
  onClearPlace,
}: StopAutocompleteInputProps) {
  const placesLib = useMapsLibrary('places');
  const [query, setQuery] = useState(selectedLabel);
  const [isOpen, setIsOpen] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync display text when parent swaps or resets stops
  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel, selectedAddress]);

  const searchTerm = query === selectedLabel ? '' : query;
  const {suggestions, isLoading, resetSession} =
    useAutocompleteSuggestions(searchTerm);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleSelectSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    if (!placesLib || !suggestion.placePrediction) return;
    setIsFetchingDetails(true);
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      const loc = place.location;
      if (loc) {
        const label =
          place.displayName ||
          suggestion.placePrediction.mainText?.text ||
          suggestion.placePrediction.text.text;
        const address =
          place.formattedAddress ||
          suggestion.placePrediction.text.text ||
          '';

        setQuery(label);
        onSelectPlace({
          label,
          address,
          position: {lat: loc.lat(), lng: loc.lng()},
        });
      }
      setIsOpen(false);
      resetSession();
    } catch (err) {
      checkAndEmitQuotaError(err);
    } finally {
      setIsFetchingDetails(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-purple-400/80 absolute left-3 pointer-events-none" />
        <input
          id={inputId}
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full h-10 pl-9 pr-9 text-sm bg-black/75 border border-purple-500/30 rounded-lg text-white placeholder:text-zinc-500 focus:outline-none focus:bg-black focus:border-purple-400 focus:ring-1 focus:ring-purple-500/50 transition-colors"
        />
        {isLoading || isFetchingDetails ? (
          <Loader2 className="w-4 h-4 text-purple-400 animate-spin absolute right-3" />
        ) : (
          query &&
          onClearPlace && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                onClearPlace();
              }}
              aria-label="Clear location"
              className="absolute right-2.5 p-1 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )
        )}
      </div>

      {selectedAddress && (
        <div className="mt-1 text-[11px] text-zinc-400 truncate pl-1">
          {selectedAddress}
        </div>
      )}

      {isOpen && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-40 left-0 right-0 mt-1.5 bg-[#0D0A14] border border-purple-500/35 rounded-lg shadow-2xl shadow-purple-950/70 max-h-56 overflow-y-auto divide-y divide-purple-500/10"
        >
          {suggestions.map((suggestion, idx) => {
            const text = suggestion.placePrediction?.text.text ?? '';
            return (
              <li key={suggestion.placePrediction?.placeId ?? idx}>
                <button
                  type="button"
                  onClick={() => void handleSelectSuggestion(suggestion)}
                  className="w-full text-left px-3.5 py-2.5 text-xs text-zinc-200 hover:bg-purple-600/25 hover:text-white flex items-start gap-2.5 transition-colors cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                  <span className="leading-snug">{text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
