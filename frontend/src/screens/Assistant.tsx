import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AssistantMessage, getAssistantHistory, sendAssistant } from '../api';
import { colors } from '../theme';
import { Button, Empty, ErrorNote, Icon, Lang, messageOf, PageTitle, plain, s, tr } from '../ui';

export default function Assistant({lang}: {lang: Lang}) {
  const [messages,setMessages] = useState<AssistantMessage[]>([]); const [text,setText] = useState(''); const [busy,setBusy] = useState(false); const [loading,setLoading] = useState(true); const [error,setError] = useState('');
  const scroll = useRef<ScrollView>(null);
  const load = useCallback(async()=>{setLoading(true);try{setMessages(await getAssistantHistory());setError('');}catch(e){setError(messageOf(e));}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  const send = async (input = text) => {
    if (busy || !input.trim() || loading) return;
    const message: AssistantMessage = {id:`local-${Date.now()}`,role:'user',content:input.trim(),created_at:new Date().toISOString()};
    setBusy(true);setError('');setText('');setMessages(prev=>[...prev,message]);
    try{const result=await sendAssistant(input.trim(),lang);setMessages(prev=>[...prev,result]);}
    catch(e){setMessages(prev=>prev.filter(item=>item.id!==message.id));setText(input);setError(messageOf(e));}
    finally{setBusy(false);}
  };
  const suggestions = lang==='mr' ? ['पावसाआधी फवारणी करावी का?','सोयाबीनची पाहणी कशी करावी?','पिकांना पाणी कधी द्यावे?'] : ['Should I spray before rain?','How do I scout my soybean crop?','When should I irrigate my field?'];
  return <KeyboardAvoidingView testID="assistant-screen" style={s.screen} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={0}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" onContentSizeChange={()=>scroll.current?.scrollToEnd({animated:true})} contentContainerStyle={s.content}><PageTitle id="assistant" eyebrow={tr(lang,'YOUR PRIVATE FARM ADVISOR','तुमचा खाजगी शेती सल्लागार')} title={tr(lang,'Ask Krushi','कृषीला विचारा')} subtitle={tr(lang,'Practical guidance. In your language.','व्यावहारिक मार्गदर्शन. तुमच्या भाषेत.')}/>
      {loading ? <ActivityIndicator color={colors.brandSecondary}/> : messages.length===0 && <><Empty id="assistant-empty" icon="sparkles-outline" title={tr(lang,'A little guidance goes a long way','योग्य सल्ल्याने शेतीला मदत')} detail={tr(lang,'Ask about crop care, weather or your next field task.','पीक काळजी, हवामान किंवा पुढील कामाबद्दल विचारा.')}/>{suggestions.map((item,i)=><Button id={`assistant-suggestion-${i}`} key={i} label={item} secondary onPress={()=>void send(item)}/>)}</>}
      {messages.map(item=><View key={item.id} testID={`chat-message-${item.id}`} style={[styles.bubble,item.role==='user'?styles.user:styles.assistant]}><Text style={s.caption}>{item.role==='user'?tr(lang,'You','तुम्ही'):'KRUSHI AI'}</Text><Text style={s.body}>{plain(item.content)}</Text></View>)}
      {busy&&<View testID="assistant-typing-indicator" style={s.row}><ActivityIndicator color={colors.brandSecondary}/><Text style={s.caption}>{tr(lang,'Thinking through your question…','तुमच्या प्रश्नावर विचार करत आहे…')}</Text></View>}
      <ErrorNote id="assistant-error" text={error}/>{!!error&&messages.length===0&&<Button id="assistant-history-retry" secondary label={tr(lang,'Reload conversation','संभाषण पुन्हा लोड करा')} onPress={()=>void load()}/>}
    </ScrollView>
    <View style={styles.composer} testID="assistant-composer"><Text testID="assistant-safety-note" style={[s.caption,s.center]}>{tr(lang,'AI can be mistaken. Verify treatments with an expert.','AI चुकू शकते. उपचार तज्ज्ञांकडून तपासा.')}</Text><View style={s.row}><TextInput testID="assistant-input" accessibilityLabel="Ask Krushi" value={text} onChangeText={setText} placeholder={tr(lang,'Ask about your crop…','तुमच्या पिकाबद्दल विचारा…')} placeholderTextColor={colors.muted} multiline maxLength={2000} style={[s.input,styles.input]}/><Pressable testID="assistant-send-button" accessibilityRole="button" accessibilityLabel="Send message" disabled={!text.trim()||busy||loading} onPress={()=>void send()} style={({pressed})=>[styles.send,(!text.trim()||busy||loading)&&s.disabled,pressed&&s.pressed]}><Icon name="arrow-up" color={colors.onBrandSecondary}/></Pressable></View></View>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({bubble:{padding:17,borderRadius:18,maxWidth:'94%',gap:8},user:{backgroundColor:colors.brandTertiary,alignSelf:'flex-end',borderBottomRightRadius:4},assistant:{backgroundColor:colors.surfaceSecondary,borderWidth:1,borderColor:colors.border,alignSelf:'flex-start',borderBottomLeftRadius:4},composer:{paddingHorizontal:18,paddingVertical:12,gap:10,borderTopWidth:1,borderTopColor:colors.border,backgroundColor:colors.surface},input:{flex:1,maxHeight:120},send:{width:50,height:52,borderRadius:14,backgroundColor:colors.brandSecondary,alignItems:'center',justifyContent:'center'}});