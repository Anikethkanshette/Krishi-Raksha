import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Text, View } from 'react-native';
import { diagnose, getLandRecords, logDownload, request } from '../api';
import { jsonBody } from '../local-api';
import { colors } from '../theme';
import { Badge, Button, ErrorNote, Field, Lang, messageOf, plain, s, Sheet, tr } from '../ui';

export function DiagnosisSheet({lang,onClose}: {lang:Lang;onClose:()=>void}) {
  const [uri,setUri]=useState(''); const [crop,setCrop]=useState(''); const [symptoms,setSymptoms]=useState('');const [busy,setBusy]=useState(false);const [result,setResult]=useState('');const [error,setError]=useState('');
  const choose=async()=>{
    setError('');
    try {
      if (Platform.OS!=='web') {const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();if(!permission.granted){setError(tr(lang,'Photo access is off. Enable it in Settings to choose a crop image.','फोटो परवानगी बंद आहे. फोटो निवडण्यासाठी सेटिंग्जमध्ये सुरू करा.'));return;}}
      const selected=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:0.75,allowsEditing:true,aspect:[4,3]});
      if(!selected.canceled){setUri(selected.assets[0].uri);setResult('');}
    }catch(e){setError(messageOf(e));}
  };
  const analyze=async()=>{
    if(!uri||!crop.trim()||!symptoms.trim()){setError(tr(lang,'Add a crop photo, crop name and the symptoms you noticed.','पिकाचा फोटो, नाव आणि दिसलेली लक्षणे भरा.'));return;}
    setBusy(true);setError('');setResult('');try{setResult((await diagnose(uri,crop.trim(),symptoms.trim(),lang)).result);}catch(e){setError(messageOf(e));}finally{setBusy(false);}
  };
  return <Sheet id="diagnosis-modal" title={tr(lang,'AI crop diagnosis','AI पीक निदान')} onClose={onClose}><Badge id="diagnosis-private-badge" label={tr(lang,'PRIVATE TO YOUR ACCOUNT','तुमच्या खात्यासाठी खाजगी')}/><Text style={s.body}>{tr(lang,'A clear photo and your field observations help build a better picture.','स्पष्ट फोटो आणि शेतातील निरीक्षणांमुळे चांगले मार्गदर्शन मिळते.')}</Text>{!!uri&&<Image testID="diagnosis-photo-preview" source={uri} style={{width:'100%',height:190,borderRadius:16}} contentFit="contain"/>}<Button id="diagnosis-photo-picker" label={tr(lang,uri?'Change photo':'Choose crop photo',uri?'फोटो बदला':'पिकाचा फोटो निवडा')} secondary icon="camera-outline" onPress={()=>void choose()} disabled={busy}/><Field id="diagnosis-crop-input" label={tr(lang,'Crop name','पिकाचे नाव')} value={crop} onChangeText={setCrop} maxLength={80}/><Field id="diagnosis-symptoms-input" label={tr(lang,'What are you noticing?','काय लक्षणे दिसत आहेत?')} value={symptoms} onChangeText={setSymptoms} multiline maxLength={2000} placeholder={tr(lang,'Yellowing, spots, curling…','पिवळेपणा, डाग, पाने वाकणे…')}/><ErrorNote id="diagnosis-error" text={error}/><Button id="diagnosis-analyze-button" label={tr(lang,'Analyze crop','पीक तपासा')} icon="scan-outline" busy={busy} onPress={()=>void analyze()}/>{!!result&&<View testID="diagnosis-result-card" style={s.card}><Text style={s.eyebrow}>KRUSHI AI</Text><Text style={s.body}>{plain(result)}</Text></View>}<Text style={s.caption}>{tr(lang,'AI guidance is not a confirmed diagnosis. Consult an agronomist before treatment. Photos are processed for analysis, not saved to your diary.','AI मार्गदर्शन निश्चित निदान नाही. उपचारापूर्वी कृषी तज्ज्ञांचा सल्ला घ्या. फोटो विश्लेषणासाठी वापरला जातो; डायरीत जतन होत नाही.')}</Text></Sheet>;
}

export function LandSheet({lang,onClose}: {lang:Lang;onClose:()=>void}) {
  const [info,setInfo]=useState<Awaited<ReturnType<typeof getLandRecords>>|null>(null);const [error,setError]=useState('');
  useEffect(()=>{void getLandRecords().then(setInfo).catch(e=>setError(messageOf(e)));},[]);
  const open=async()=>{if(!info)return;try{await Linking.openURL(info.official_url);void logDownload({district:'',taluka:'',village:'',survey_number:''}).catch(()=>undefined);}catch(e){setError(messageOf(e));}};
  return <Sheet id="land-records-modal" title={tr(lang,'Your 7/12 land record','तुमचा ७/१२ उतारा')} onClose={onClose}><Badge id="land-official-badge" label={tr(lang,'OFFICIAL GOVERNMENT PORTAL','अधिकृत शासकीय पोर्टल')}/><Text style={s.body}>{tr(lang,'Use this guide to view records on Mahabhulekh. For certified copies, follow the government’s digital-signature service.','महाभूलेखवर उतारा पाहण्यासाठी मार्गदर्शक. प्रमाणित प्रतीसाठी शासनाची डिजिटल स्वाक्षरी सेवा वापरा.')}</Text><ErrorNote id="land-error" text={error}/>{!info&&!error&&<ActivityIndicator color={colors.brandSecondary}/>}{info?.steps.map(step=><View testID={`land-step-${step.number}`} key={step.number} style={[s.card,s.row]}><Text style={s.eyebrow}>{String(step.number).padStart(2,'0')}</Text><Text style={[s.body,s.flex]}>{lang==='mr'?step.title_mr:step.title}</Text></View>)}<Button id="land-portal-open-button" label={tr(lang,'Open official portal','अधिकृत पोर्टल उघडा')} icon="open-outline" disabled={!info} onPress={()=>void open()}/><Text testID="land-privacy-disclaimer" style={s.caption}>{tr(lang,'This opens your browser. Krushi Raksha cannot retrieve or certify your record and never asks for your government password or OTP. You may also obtain a copy at your local talathi office.','हे ब्राउझरमध्ये उघडेल. कृषी रक्षण उतारा मिळवत किंवा प्रमाणित करत नाही. सरकारी पासवर्ड किंवा OTP विचारत नाही. स्थानिक तलाठी कार्यालयातूनही प्रत मिळवू शकता.')}</Text></Sheet>;
}

export function CropSheet({lang,onClose,onSaved}: {lang:Lang;onClose:()=>void;onSaved:()=>void}) {
  const [name,setName]=useState('');const [variety,setVariety]=useState('');const [area,setArea]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const save=async()=>{if(!name.trim()||!Number.isFinite(Number(area))||Number(area)<=0){setError(tr(lang,'Add a crop name and valid area.','पिकाचे नाव आणि योग्य क्षेत्रफळ भरा.'));return;}setBusy(true);setError('');try{await request('/crops',jsonBody({name:name.trim(),variety:variety.trim(),area_acres:Number(area)}));onSaved();}catch(e){setError(messageOf(e));}finally{setBusy(false);}};
  return <Sheet id="crop-modal" title={tr(lang,'Add your crop','तुमचे पीक जोडा')} onClose={onClose}><Field id="crop-name-input" label={tr(lang,'Crop name','पिकाचे नाव')} value={name} onChangeText={setName} maxLength={80}/><Field id="crop-variety-input" label={tr(lang,'Variety (optional)','वाण (ऐच्छिक)')} value={variety} onChangeText={setVariety} maxLength={80}/><Field id="crop-area-input" label={tr(lang,'Area in acres','क्षेत्रफळ (एकर)')} value={area} onChangeText={setArea} keyboardType="decimal-pad"/><ErrorNote id="crop-error" text={error}/><Button id="crop-save-button" label={tr(lang,'Save crop','पीक जतन करा')} busy={busy} onPress={()=>void save()}/></Sheet>;
}