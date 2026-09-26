import { useState } from 'react';
import { Text, View } from 'react-native';
import { DateField } from '../components/DateField';
import { createListing, FarmLocation, Listing, ListingKind, respondToListing } from '../local-api';
import { Badge, Button, Chips, ErrorNote, Field, Lang, messageOf, money, s, Sheet, today, tr } from '../ui';

export const categories = (board: 'tools' | 'work', lang: Lang) => (board === 'tools' ? [
  ['tractor','Tractors','ट्रॅक्टर'],['sprayer','Sprayers','फवारणी यंत्र'],['harvester','Harvesters','कापणी यंत्र'],['tiller','Tillers','पॉवर टिलर'],['other','Other','इतर'],
] : [['sowing','Sowing','पेरणी'],['harvest','Harvest','कापणी'],['spraying','Spraying','फवारणी'],['irrigation','Irrigation','पाणी'],['general','General','सर्वसाधारण']]).map(([value,en,mr]) => ({value,label: tr(lang,en,mr)}));
export const statusLabel = (value: string, lang: Lang) => ({open: tr(lang,'Open','उपलब्ध'),closed: tr(lang,'Closed','बंद'),pending: tr(lang,'Pending','प्रलंबित'),accepted: tr(lang,'Accepted','स्वीकृत'),declined: tr(lang,'Declined','नाकारले'),cancelled: tr(lang,'Cancelled','रद्द')}[value] || value);

export function CreateListingSheet({board, location, lang, onClose, onSaved}: {board: 'tools' | 'work'; location: FarmLocation; lang: Lang; onClose: () => void; onSaved: () => void}) {
  const [kind,setKind] = useState<ListingKind>(board === 'tools' ? 'tool' : 'job');
  const [title,setTitle] = useState(''); const [description,setDescription] = useState('');
  const [category,setCategory] = useState(board === 'tools' ? 'tractor' : 'sowing');
  const [rate,setRate] = useState(''); const [phone,setPhone] = useState(''); const [people,setPeople] = useState('1');
  const [start,setStart] = useState(today()); const [end,setEnd] = useState(today());
  const [error,setError] = useState(''); const [busy,setBusy] = useState(false);
  const save = async () => {
    setError('');
    if (title.trim().length < 3 || description.trim().length < 10) {setError(tr(lang,'Add a title (3+ letters) and details (10+ letters).','शीर्षक (३+ अक्षरे) आणि तपशील (१०+ अक्षरे) भरा.')); return;}
    if (!Number.isFinite(Number(rate)) || Number(rate) <= 0 || !/^\+?\d{10,13}$/.test(phone.trim())) {setError(tr(lang,'Enter a positive daily rate and a valid 10-digit mobile number.','योग्य दैनिक दर आणि १० अंकी मोबाइल क्रमांक भरा.')); return;}
    if (board === 'work' && (!Number.isInteger(Number(people)) || Number(people) < 1 || Number(people) > 100)) {setError(tr(lang,'Enter a team size from 1 to 100.','१ ते १०० व्यक्तींची संख्या भरा.')); return;}
    setBusy(true);
    try {await createListing({kind,title,description,category,daily_rate:Number(rate),phone:phone.trim(),people:board === 'tools' ? 1 : Number(people),start_date:start,end_date:end,location_name:location.source === 'gps' && /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(location.name) ? `GPS area (${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)})` : location.name,latitude:location.latitude,longitude:location.longitude}); onSaved();}
    catch (e) {setError(messageOf(e));} finally {setBusy(false);}
  };
  return <Sheet id="create-listing-modal" title={tr(lang,board === 'tools' ? 'List your equipment' : 'Post to the work board',board === 'tools' ? 'तुमचे अवजार नोंदवा' : 'कामाच्या फलकावर नोंदवा')} onClose={onClose}>
    {board === 'work' && <Chips id="listing-kind" value={kind} onChange={v => setKind(v as ListingKind)} items={[{value:'job',label:tr(lang,'I’m hiring','मजूर हवे आहेत')},{value:'worker',label:tr(lang,'I’m available','कामासाठी उपलब्ध')}]}/>}
    <Badge id="listing-location" label={location.name}/><Field id="listing-title-input" label={tr(lang,'Title','शीर्षक')} value={title} onChangeText={setTitle} maxLength={100} placeholder={tr(lang,board === 'tools' ? 'e.g. Mahindra tractor, 45 HP' : kind === 'job' ? 'e.g. Workers for onion harvest' : 'e.g. Sowing team available',board === 'tools' ? 'उदा. महिंद्रा ट्रॅक्टर, ४५ HP' : 'उदा. कांदा कापणीसाठी मजूर')}/>
    <Text style={s.label}>{tr(lang,'Category','प्रकार')}</Text><Chips id="listing-category" value={category} onChange={setCategory} items={categories(board,lang)}/>
    <Field id="listing-description-input" label={tr(lang,'Details','तपशील')} value={description} onChangeText={setDescription} multiline maxLength={2000} placeholder={tr(lang,'Condition, tasks, experience and what is included…','स्थिती, काम, अनुभव आणि इतर माहिती…')}/>
    <Field id="listing-rate-input" label={tr(lang,board === 'tools' ? 'Daily rent (₹)' : 'Daily wage per person (₹)',board === 'tools' ? 'दैनिक भाडे (₹)' : 'प्रति व्यक्ती दैनिक मजुरी (₹)')} value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="0"/>
    {board === 'work' && <Field id="listing-people-input" label={tr(lang,kind === 'job' ? 'Workers needed' : 'People available',kind === 'job' ? 'आवश्यक मजूर' : 'उपलब्ध व्यक्ती')} value={people} onChangeText={setPeople} keyboardType="number-pad"/>}
    <DateField id="listing-start-date" label={tr(lang,'Available from','पासून उपलब्ध')} value={start} onChange={v => {setStart(v); if (v>end) setEnd(v);}} lang={lang}/>
    <DateField id="listing-end-date" label={tr(lang,'Available until','पर्यंत उपलब्ध')} value={end} onChange={setEnd} min={start} lang={lang}/>
    <Field id="listing-phone-input" label={tr(lang,'Mobile number','मोबाइल क्रमांक')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} placeholder={tr(lang,'10-digit mobile number','१० अंकी मोबाइल क्रमांक')}/>
    <Text testID="listing-publish-disclosure" style={s.caption}>{tr(lang,'Publishing shares your name, listing and approximate area with signed-in farmers. Phone numbers are shared only after a response is accepted. Arrange payment directly; the app does not collect money.','प्रकाशित केल्यावर नाव, जाहिरात आणि परिसर इतर शेतकऱ्यांना दिसेल. प्रतिसाद स्वीकारल्यानंतरच फोन क्रमांक दिसेल. देयक थेट ठरवा; अॅप पैसे घेत नाही.')}</Text>
    <ErrorNote id="listing-form-error" text={error}/><Button id="publish-listing-button" label={tr(lang,'Publish listing','जाहिरात प्रकाशित करा')} icon="add" onPress={() => void save()} busy={busy}/>
  </Sheet>;
}

export function RespondSheet({listing, lang, onClose, onSaved}: {listing: Listing; lang: Lang; onClose: () => void; onSaved: () => void}) {
  const [start,setStart] = useState(listing.start_date < today() ? today() : listing.start_date);
  const [end,setEnd] = useState(listing.start_date < today() ? today() : listing.start_date);
  const [phone,setPhone] = useState(''); const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const days = Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  const submit = async () => {
    if (!/^\+?\d{10,13}$/.test(phone.trim())) {setError(tr(lang,'Enter a valid mobile number.','योग्य मोबाइल क्रमांक भरा.')); return;}
    setBusy(true); setError('');
    try {await respondToListing(listing.id,{phone:phone.trim(),message,start_date:start,end_date:end}); onSaved();}
    catch (e) {setError(messageOf(e));} finally {setBusy(false);}
  };
  return <Sheet id="listing-response-modal" title={tr(lang,listing.kind === 'tool' ? 'Request to rent' : 'Mark your interest',listing.kind === 'tool' ? 'भाड्याची विनंती' : 'स्वारस्य नोंदवा')} onClose={onClose}>
    <Text testID="response-listing-title" style={s.h3}>{listing.title}</Text>
    <DateField id="response-start-date" label={tr(lang,'From','पासून')} value={start} min={listing.start_date > today() ? listing.start_date : today()} max={listing.end_date} onChange={v => {setStart(v); if (v>end) setEnd(v);}} lang={lang}/>
    <DateField id="response-end-date" label={tr(lang,'Until','पर्यंत')} value={end} min={start} max={listing.end_date} onChange={setEnd} lang={lang}/>
    <View testID="response-cost-summary" style={s.card}><Text style={s.caption}>{tr(lang,listing.kind === 'tool' ? 'Estimated rental · no payment now' : 'Estimated wage · per person',listing.kind === 'tool' ? 'अंदाजित भाडे · आता देयक नाही' : 'अंदाजित मजुरी · प्रति व्यक्ती')}</Text><Text style={s.h2}>{money(days * listing.daily_rate)}</Text><Text style={s.caption}>{days} {tr(lang,'days','दिवस')} × {money(listing.daily_rate)}</Text></View>
    <Field id="response-phone-input" label={tr(lang,'Your mobile number','तुमचा मोबाइल क्रमांक')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14}/>
    <Field id="response-message-input" label={tr(lang,'Message (optional)','संदेश (ऐच्छिक)')} value={message} onChangeText={setMessage} multiline maxLength={500}/>
    <Text testID="response-privacy-note" style={s.caption}>{tr(lang,'This sends a request, not a confirmed booking. Both phone numbers are shared after acceptance. Confirm work, pickup and payment directly.','ही विनंती आहे, निश्चित बुकिंग नाही. स्वीकृतीनंतर दोन्ही फोन क्रमांक दिसतील. काम, ने-आण आणि देयक थेट ठरवा.')}</Text>
    <ErrorNote id="response-form-error" text={error}/><Button id="send-response-button" label={tr(lang,listing.kind === 'tool' ? 'Send rental request' : 'Send interest',listing.kind === 'tool' ? 'भाड्याची विनंती पाठवा' : 'स्वारस्य पाठवा')} busy={busy} onPress={() => void submit()}/>
  </Sheet>;
}