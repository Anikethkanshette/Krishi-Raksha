import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from 'react-native';
import { FarmLocation, getLocation, saveLocation, searchLocations } from './local-api';
import { colors } from './theme';
import { Badge, Button, ErrorNote, Field, Icon, Lang, messageOf, s, Sheet, tr } from './ui';

async function gpsLocation(): Promise<FarmLocation> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error(permission.canAskAgain ? 'Location access was denied. Choose a village or try GPS again.' : 'Location access is off. Enable precise location in Settings, or choose a village.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reading = await Promise.race([
      Location.getCurrentPositionAsync({accuracy: Location.Accuracy.Highest}),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('GPS is taking longer than expected. Try outdoors or select a village.')), 18000); }),
    ]);
    const {latitude, longitude, accuracy} = reading.coords;
    let name = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    if (Platform.OS !== 'web') {
      try {
        const result = await Location.reverseGeocodeAsync({latitude, longitude});
        const a = result[0];
        if (a) name = Array.from(new Set([a.city || a.subregion, a.region].filter(Boolean))).join(', ') || name;
      } catch { /* Coordinates remain usable if the device geocoder is unavailable. */ }
    }
    return {latitude, longitude, accuracy, name, source: 'gps'};
  } finally { if (timer) clearTimeout(timer); }
}

export function useFarmLocation() {
  const [location, setLocation] = useState<FarmLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const select = useCallback(async (next: FarmLocation) => {
    const saved = await saveLocation(next);
    setLocation(saved); setError('');
  }, []);
  const useGps = useCallback(async () => { await select(await gpsLocation()); }, [select]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = await getLocation();
        if (!active) return;
        if (saved) setLocation(saved);
        else await useGps();
      } catch (e) { if (active) setError(messageOf(e)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [useGps]);
  return {location, loading, error, select, useGps};
}

export function LocationPicker({lang, location, onSelect, onGps, onClose}: {lang: Lang; location: FarmLocation | null; onSelect: (v: FarmLocation) => Promise<void>; onGps: () => Promise<void>; onClose: () => void}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(FarmLocation & {id: string})[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setResults([]); setError('');
    if (q.trim().length < 2) {setSearching(false); return;}
    setSearching(true);
    const timeout = setTimeout(() => { void searchLocations(q).then(items => {if (active) setResults(items);}).catch(e => {if (active) setError(messageOf(e));}).finally(() => {if (active) setSearching(false);}); }, 350);
    return () => {active = false; clearTimeout(timeout);};
  }, [q]);
  const choose = async (item?: FarmLocation) => {
    setBusy(true); setError('');
    try { if (item) await onSelect(item); else await onGps(); onClose(); }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  };
  return <Sheet id="location-picker-modal" title={tr(lang, 'Choose your location', 'तुमचे ठिकाण निवडा')} onClose={onClose}>
    <Text testID="location-privacy-note" style={s.body}>{tr(lang, 'Used for local weather, nearby tools and work. Listings show your area, not your exact GPS position.', 'स्थानिक हवामान, अवजारे आणि काम शोधण्यासाठी. जाहिरातीत अचूक GPS नव्हे, तुमचा परिसर दिसतो.')}</Text>
    {location && <Badge id="current-location-label" label={location.name}/>}
    <Button id="gps-refresh-button" label={tr(lang, 'Use precise GPS location', 'अचूक GPS ठिकाण वापरा')} icon="locate-outline" busy={busy} onPress={() => void choose()}/>
    <Text style={s.caption}>{tr(lang, 'Accuracy depends on your device and permission settings. No background tracking.', 'अचूकता उपकरण आणि परवानगीवर अवलंबून असते. पार्श्वभूमीत ट्रॅकिंग नाही.')}</Text>
    <View style={s.line}/><Field id="location-search-input" label={tr(lang, 'Or search village / city', 'किंवा गाव / शहर शोधा')} value={q} onChangeText={setQ} placeholder={tr(lang, 'e.g. Nashik, Pune, Baramati', 'उदा. नाशिक, पुणे, बारामती')} autoCorrect={false}/>
    <ErrorNote id="location-error" text={error}/>
    {!!error && Platform.OS !== 'web' && <Button id="location-settings-button" label={tr(lang, 'Open device settings', 'उपकरण सेटिंग्ज उघडा')} secondary onPress={() => void Linking.openSettings().catch(() => setError('Please open your device Settings manually.'))}/>}
    {searching ? <ActivityIndicator testID="location-search-loading" color={colors.brandSecondary}/> : results.map((item) => <Pressable key={item.id} testID={`location-option-${item.id}`} disabled={busy} onPress={() => void choose(item)} style={({pressed}) => [s.card, s.row, pressed && s.pressed]}><Icon name="location-outline" color={colors.brandSecondary}/><Text style={[s.body,s.flex]}>{item.name}</Text><Icon name="chevron-forward" size={18}/></Pressable>)}
    {!searching && q.length >= 2 && !results.length && !error && <Text testID="location-no-results" style={s.body}>{tr(lang, 'No exact village found. Try another spelling or search for a nearby town.', 'अचूक गाव सापडले नाही. दुसरे स्पेलिंग किंवा जवळचे शहर शोधा.')}</Text>}
    <Text testID="location-attribution" style={s.caption}>Location search: Open-Meteo · GeoNames</Text>
  </Sheet>;
}