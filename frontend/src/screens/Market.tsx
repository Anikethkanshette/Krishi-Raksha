import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { decideResponse, FarmLocation, getActivity, getListing, getListings, Listing, MarketActivity, setListingStatus } from '../local-api';
import { colors } from '../theme';
import { showToast } from '../toast';
import { Badge, Button, Chips, dateLabel, Empty, ErrorNote, Field, Icon, IconButton, Lang, messageOf, money, PageTitle, s, Sheet, tr } from '../ui';
import { categories, CreateListingSheet, RespondSheet, statusLabel } from './MarketForms';

export default function Market({board, lang, location, onLocation}: {board: 'tools' | 'work'; lang: Lang; location: FarmLocation | null; onLocation: () => void}) {
  const [view,setView] = useState('nearby'); const [kind,setKind] = useState(''); const [category,setCategory] = useState('');
  const [radius,setRadius] = useState('25'); const [q,setQ] = useState(''); const [debounced,setDebounced] = useState('');
  const [listings,setListings] = useState<Listing[]>([]); const [activity,setActivity] = useState<MarketActivity[]>([]);
  const [loading,setLoading] = useState(true); const [error,setError] = useState(''); const [create,setCreate] = useState(false);
  const [detail,setDetail] = useState<Listing | null>(null); const [respond,setRespond] = useState<Listing | null>(null);
  const [decisionBusy,setDecisionBusy] = useState('');
  useEffect(() => {const timer = setTimeout(() => setDebounced(q),300); return () => clearTimeout(timer);},[q]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (view === 'activity') setActivity(await getActivity(board));
      else if (location || view === 'mine') setListings(await getListings({board,mine:view === 'mine',category,...(kind ? {kind} : {}),q:debounced,radius,latitude:location?.latitude ?? 0,longitude:location?.longitude ?? 0}));
      else setListings([]);
    } catch (e) {setError(messageOf(e));} finally {setLoading(false);}
  },[board,view,location,category,kind,debounced,radius]);
  useEffect(() => { void load(); },[load]);
  const update = async (item: MarketActivity, status: string) => {
    setDecisionBusy(item.id); setError('');
    try {await decideResponse(item.listing_id,item.id,status); await load(); showToast(tr(lang,'Response updated','प्रतिसाद अपडेट केला'));}
    catch (e) {setError(messageOf(e));} finally {setDecisionBusy('');}
  };
  const openDetail = async (item: Listing) => {
    setDetail(item);
    try {setDetail(await getListing(item.id));} catch (e) {setError(messageOf(e));}
  };
  const onSaved = () => {setCreate(false); setRespond(null); setDetail(null); void load(); showToast(tr(lang,'Saved successfully','यशस्वीरित्या जतन केले'));};
  return <View style={s.screen}><ScrollView testID={`${board}-screen`} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.brandSecondary}/>}>
    <PageTitle id={board} eyebrow={tr(lang,'YOUR LOCAL COMMUNITY','तुमचा स्थानिक समुदाय')} title={tr(lang,board === 'tools' ? 'Tool rentals' : 'Farm work',board === 'tools' ? 'अवजारे भाड्याने' : 'शेतीचे काम')} subtitle={tr(lang,board === 'tools' ? 'The right equipment. Closer to home.' : 'Good work starts with good connections.',board === 'tools' ? 'योग्य अवजारे. घराजवळच.' : 'योग्य कामासाठी योग्य माणसे.')} action={<IconButton id="open-create-listing" label="Create listing" icon="add" onPress={() => location ? setCreate(true) : onLocation()}/>}/>
    <Chips id="market-view" value={view} onChange={setView} items={[{value:'nearby',label:tr(lang,'Nearby','जवळपास')},{value:'mine',label:tr(lang,'My listings','माझ्या जाहिराती')},{value:'activity',label:tr(lang,'Requests','विनंत्या')}]}/>
    {view !== 'activity' && <><Field id="market-search-input" label={tr(lang,'Search listings','जाहिराती शोधा')} value={q} onChangeText={setQ} placeholder={tr(lang,board === 'tools' ? 'Search equipment…' : 'Search work or skills…',board === 'tools' ? 'अवजारे शोधा…' : 'काम किंवा कौशल्य शोधा…')}/>
    {board === 'work' && <Chips id="work-kind-filter" value={kind} onChange={setKind} items={[{value:'',label:tr(lang,'All','सर्व')},{value:'job',label:tr(lang,'Hiring','मजूर हवे')},{value:'worker',label:tr(lang,'Available workers','उपलब्ध मजूर')}]}/>}
    <Chips id="market-category" value={category} onChange={setCategory} items={[{value:'',label:tr(lang,'All categories','सर्व प्रकार')},...categories(board,lang)]}/>
    {view === 'nearby' && <View style={styles.locationBar}><Pressable testID="market-change-location" onPress={onLocation} style={[s.row,s.flex,styles.locationPress]}><Icon name="location-outline" size={16} color={colors.brandSecondary}/><Text testID="market-location-label" numberOfLines={1} style={[s.caption,s.flex]}>{location?.name || tr(lang,'Choose location','ठिकाण निवडा')}</Text></Pressable><Chips id="market-radius" value={radius} onChange={setRadius} items={['10','25','50'].map(value => ({value,label:`${value} km`}))}/></View>}</>}
    <ErrorNote id="market-error" text={error}/>{!!error && <Button id="market-retry-button" label={tr(lang,'Try again','पुन्हा प्रयत्न करा')} secondary onPress={() => void load()}/>}
    {loading ? <ActivityIndicator testID="market-loading" color={colors.brandSecondary}/> : view === 'activity' ? activity.length ? activity.map(item => <ActivityCard key={item.id} item={item} lang={lang} busy={decisionBusy === item.id} onDecision={status => void update(item,status)}/>) : <Empty id="activity-empty" icon="mail-outline" title={tr(lang,'Your connections start here','तुमच्या जोडणीची सुरुवात इथून')} detail={tr(lang,'Rental requests and work responses you send or receive will appear here. Only you can see this view.','पाठवलेल्या आणि आलेल्या विनंत्या येथे दिसतील. हे पान केवळ तुम्हालाच दिसेल.')}/> : !location && view === 'nearby' ? <Empty id="market-needs-location" icon="locate-outline" title={tr(lang,'Find your local community','तुमचा स्थानिक समुदाय शोधा')} detail={tr(lang,'Choose GPS or a village to discover nearby listings.','जवळच्या जाहिरातींसाठी GPS किंवा गाव निवडा.')}><Button id="market-choose-location" label={tr(lang,'Choose location','ठिकाण निवडा')} onPress={onLocation}/></Empty> : listings.length ? listings.map(item => <ListingCard key={item.id} item={item} lang={lang} onPress={() => void openDetail(item)}/>) : !error && <Empty id="market-empty" icon={board === 'tools' ? 'construct-outline' : 'people-outline'} title={tr(lang,view === 'mine' ? 'Your first listing awaits' : 'Let’s grow this community',view === 'mine' ? 'तुमची पहिली जाहिरात द्या' : 'हा समुदाय वाढवूया')} detail={tr(lang,view === 'mine' ? 'List equipment or share work opportunities with farmers around you.' : 'No listings match this view yet. Expand your radius, change filters, or be the first to post.',view === 'mine' ? 'तुमच्या परिसरातील शेतकऱ्यांसाठी अवजारे किंवा काम नोंदवा.' : 'अजून जाहिराती नाहीत. अंतर वाढवा, फिल्टर बदला किंवा पहिली जाहिरात द्या.')}><Button id="market-empty-create" label={tr(lang,board === 'tools' ? 'List equipment' : 'Post to the board',board === 'tools' ? 'अवजार नोंदवा' : 'फलकावर नोंदवा')} icon="add" onPress={() => location ? setCreate(true) : onLocation()}/></Empty>}
    <Text testID="market-safety-note" style={s.caption}>{tr(lang,'Community listings are posted by members, not verified by Krushi Raksha. Inspect equipment and agree on terms before paying.','जाहिराती सदस्यांनी दिलेल्या आहेत; कृषी रक्षणने पडताळलेल्या नाहीत. देयकापूर्वी अवजारे तपासा आणि अटी ठरवा.')}</Text>
  </ScrollView>
  {create && location && <CreateListingSheet board={board} location={location} lang={lang} onClose={() => setCreate(false)} onSaved={onSaved}/>}
  {detail && !respond && <ListingDetail listing={detail} lang={lang} onClose={() => setDetail(null)} onRespond={() => setRespond(detail)} onChanged={item => {setDetail(item); void load();}}/>}
  {respond && <RespondSheet listing={respond} lang={lang} onClose={() => setRespond(null)} onSaved={onSaved}/>}
  </View>;
}

function ListingCard({item,lang,onPress}: {item: Listing; lang: Lang; onPress: () => void}) {
  return <Pressable testID={`listing-card-${item.id}`} onPress={onPress} accessibilityRole="button" style={({pressed}) => [s.card, pressed && s.pressed]}>
    <View style={[s.row,s.between]}><View style={styles.toolIcon}><Icon name={item.kind === 'tool' ? 'construct-outline' : item.kind === 'job' ? 'briefcase-outline' : 'people-outline'} size={28} color={colors.brandSecondary}/></View><Badge id={`listing-kind-${item.id}`} label={item.is_owner ? tr(lang,'YOUR LISTING','तुमची जाहिरात') : item.kind === 'tool' ? tr(lang,'EQUIPMENT','अवजार') : item.kind === 'job' ? tr(lang,'HIRING','मजूर हवे') : tr(lang,'AVAILABLE','उपलब्ध')} gold/></View>
    <Text testID={`listing-title-${item.id}`} style={s.h2}>{item.title}</Text><Text testID={`listing-description-${item.id}`} style={s.subtitle} numberOfLines={2}>{item.description}</Text><View style={s.line}/><View style={[s.row,s.between]}><View style={s.flex}><Text testID={`listing-rate-${item.id}`} style={styles.price}>{money(item.daily_rate)}<Text style={s.caption}> / {tr(lang,'day','दिवस')}</Text></Text><Text testID={`listing-owner-${item.id}`} style={s.caption}>{item.owner_name}</Text></View><Text testID={`listing-distance-${item.id}`} style={s.caption}>{item.distance_km != null ? `~${item.distance_km} km` : statusLabel(item.status,lang)}</Text></View><Text testID={`listing-area-${item.id}`} style={s.caption} numberOfLines={1}>{item.location_name}</Text>
  </Pressable>;
}
function ListingDetail({listing,lang,onClose,onRespond,onChanged}: {listing: Listing; lang: Lang; onClose: () => void; onRespond: () => void; onChanged: (v: Listing) => void}) {
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const change = async () => {setBusy(true); try {onChanged(await setListingStatus(listing.id,listing.status === 'open' ? 'closed' : 'open'));} catch(e){setError(messageOf(e));} finally{setBusy(false);}};
  return <Sheet id="listing-detail-modal" title={listing.title} onClose={onClose}><Badge id="listing-detail-status" label={statusLabel(listing.status,lang)}/><Text style={styles.price} testID="listing-detail-price">{money(listing.daily_rate)} <Text style={s.body}>/ {tr(lang,'day','दिवस')}</Text></Text><Text style={s.body} testID="listing-detail-description">{listing.description}</Text><Text style={s.body} testID="listing-detail-owner">{listing.owner_name} · {listing.location_name}</Text><Text style={s.body} testID="listing-detail-dates">{dateLabel(listing.start_date,lang)} — {dateLabel(listing.end_date,lang)}</Text>{listing.kind !== 'tool' && <Text testID="listing-detail-people" style={s.body}>{listing.people} {tr(lang,'people · wage is per person','व्यक्ती · मजुरी प्रति व्यक्ती')}</Text>}
    <ErrorNote id="listing-detail-error" text={error}/>{listing.is_owner ? <><Text style={s.caption}>{tr(lang,'Closing hides this listing from nearby search. Existing requests remain in your Requests tab.','बंद केल्यावर जाहिरात शोधात दिसणार नाही. जुन्या विनंत्या विनंत्या विभागात राहतील.')}</Text><Button id="listing-toggle-status" label={tr(lang,listing.status === 'open' ? 'Close listing' : 'Reopen listing',listing.status === 'open' ? 'जाहिरात बंद करा' : 'जाहिरात पुन्हा उघडा')} secondary busy={busy} onPress={() => void change()}/></> : listing.my_request && ['pending','accepted'].includes(listing.my_request.status) ? <Badge id="listing-my-response-status" label={`${tr(lang,'Your response','तुमचा प्रतिसाद')}: ${statusLabel(listing.my_request.status,lang)}`}/> : <Button id="listing-respond-button" label={tr(lang,listing.kind === 'tool' ? 'Request to rent' : 'Mark interest',listing.kind === 'tool' ? 'भाड्याची विनंती करा' : 'स्वारस्य नोंदवा')} disabled={listing.status !== 'open'} onPress={onRespond}/>}
    {!!listing.phone && !listing.is_owner && <Button id="listing-call-owner" label={tr(lang,'Call owner','मालकाला फोन करा')} icon="call-outline" onPress={() => void Linking.openURL(`tel:${listing.phone}`).catch(() => setError(`Contact: ${listing.phone}`))}/>}
  </Sheet>;
}
function ActivityCard({item,lang,busy,onDecision}: {item: MarketActivity; lang: Lang; busy: boolean; onDecision: (status: string) => void}) {
  const [error,setError] = useState('');
  return <View testID={`activity-card-${item.id}`} style={s.card}><View style={[s.row,s.between]}><Text style={s.eyebrow}>{tr(lang,item.incoming ? 'RECEIVED' : 'SENT',item.incoming ? 'आलेली' : 'पाठवलेली')}</Text><Badge id={`activity-status-${item.id}`} label={statusLabel(item.status,lang)} gold/></View><Text style={s.h3}>{item.title}</Text><Text style={s.body}>{item.other_name}</Text><Text style={s.caption}>{dateLabel(item.start_date,lang)} — {dateLabel(item.end_date,lang)}</Text><Text testID={`activity-total-${item.id}`} style={s.body}>{money(item.total)}{item.kind !== 'tool' ? tr(lang,' / person',' / व्यक्ती') : ''}</Text>{!!item.message && <Text style={s.body}>{item.message}</Text>}
    {item.incoming && item.status === 'pending' && <View style={s.row}><View style={s.flex}><Button id={`accept-response-${item.id}`} label={tr(lang,'Accept','स्वीकारा')} busy={busy} onPress={() => onDecision('accepted')}/></View><View style={s.flex}><Button id={`decline-response-${item.id}`} label={tr(lang,'Decline','नाकारा')} secondary busy={busy} onPress={() => onDecision('declined')}/></View></View>}
    {!item.incoming && ['pending','accepted'].includes(item.status) && <Button id={`cancel-response-${item.id}`} label={tr(lang,'Cancel response','प्रतिसाद रद्द करा')} secondary busy={busy} onPress={() => onDecision('cancelled')}/>}
    {!!item.phone && <Button id={`call-contact-${item.id}`} label={`${tr(lang,'Call','फोन करा')} · ${item.phone}`} icon="call-outline" onPress={() => void Linking.openURL(`tel:${item.phone}`).catch(() => setError(`Contact: ${item.phone}`))}/>}
    <ErrorNote id={`activity-error-${item.id}`} text={error}/>
  </View>;
}
const styles = StyleSheet.create({locationBar: {gap: 10}, locationPress: {minHeight: 44}, toolIcon: {width: 60, height: 60, borderRadius: 16, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center'}, price: {color: colors.brandSecondary, fontSize: 26, fontWeight: '700'}});