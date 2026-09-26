import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { dateLabel, Icon, IconButton, Lang, s, Sheet, today, tr } from '../ui';

export function DateField({id, label, value, onChange, min = today(), max, lang}: {id: string; label: string; value: string; onChange: (date: string) => void; min?: string; max?: string; lang: Lang}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(`${value}T12:00:00`));
  const key = (day: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const start = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return <View style={s.fieldWrap}><Text style={s.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={label} testID={id} onPress={() => {setMonth(new Date(`${value}T12:00:00`)); setOpen(true);}} style={[s.input,s.row,s.between]}><Text testID={`${id}-value`} style={s.body}>{dateLabel(value,lang)}</Text><Icon name="calendar-outline" size={18} color={colors.brandSecondary}/></Pressable>
    {open && <Sheet id={`${id}-calendar`} title={label} onClose={() => setOpen(false)}><View style={[s.row,s.between]}><IconButton id={`${id}-previous-month`} label="Previous month" icon="chevron-back" onPress={() => setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}/><Text testID={`${id}-month`} style={s.h3}>{month.toLocaleDateString(lang === 'mr' ? 'mr-IN' : 'en-IN', {month: 'long', year: 'numeric'})}</Text><IconButton id={`${id}-next-month`} label="Next month" icon="chevron-forward" onPress={() => setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}/></View>
      <View style={styles.grid}>{(lang === 'mr' ? ['र','सो','मं','बु','गु','शु','श'] : ['S','M','T','W','T','F','S']).map((day,i) => <View key={i} style={styles.day}><Text style={s.caption}>{day}</Text></View>)}{Array.from({length:start},(_,i) => <View key={`blank-${i}`} style={styles.day}/>)}{Array.from({length:count},(_,i) => {
        const date = key(i+1); const disabled = date < min || (!!max && date > max);
        return <Pressable key={date} testID={`${id}-day-${date}`} accessibilityRole="button" disabled={disabled} onPress={() => {onChange(date); setOpen(false);}} style={({pressed}) => [styles.day, date === value && styles.selected, disabled && s.disabled, pressed && s.pressed]}><Text style={s.body}>{i+1}</Text></Pressable>;
      })}</View><Text style={s.caption}>{tr(lang,'Only available dates can be selected.','केवळ उपलब्ध तारखा निवडता येतात.')}</Text></Sheet>}
  </View>;
}
const styles = StyleSheet.create({grid: {flexDirection: 'row', flexWrap: 'wrap'}, day: {width: '14.2857%', minHeight: 46, justifyContent: 'center', alignItems: 'center', borderRadius: 10}, selected: {backgroundColor: colors.brandPrimary}});