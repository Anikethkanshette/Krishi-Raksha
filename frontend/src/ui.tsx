import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './theme';

export type Lang = 'en' | 'mr';
export const tr = (lang: Lang, en: string, mr: string) => lang === 'mr' ? mr : en;
export type IconName = keyof typeof Ionicons.glyphMap;
export const money = (amount: number) => `₹${amount.toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
export const plain = (text: string) => text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#{1,6}\s/gm, '').replace(/^\*\s/gm, '• ');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const dateLabel = (value: string, lang: Lang = 'en') => new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString(lang === 'mr' ? 'mr-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const messageOf = (e: unknown) => e instanceof Error ? e.message : 'Unable to connect. Please try again.';

export function Icon({name, size = 22, color = colors.onSurface}: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}
export function Button({id, label, icon, onPress, busy = false, disabled = false, secondary = false}: {id: string; label: string; icon?: IconName; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean}) {
  return <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled} onPress={onPress} style={({pressed}) => [s.button, secondary && s.secondary, (busy || disabled) && s.disabled, pressed && s.pressed]}>
    {busy ? <ActivityIndicator color={secondary ? colors.onSurface : colors.onBrandSecondary} /> : <>{icon ? <Icon name={icon} color={secondary ? colors.onSurface : colors.onBrandSecondary} /> : null}<Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text></>}
  </Pressable>;
}
export function IconButton({id, icon, onPress, label}: {id: string; icon: IconName; onPress: () => void; label: string}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={id} onPress={onPress} style={({pressed}) => [s.iconButton, pressed && s.pressed]}><Icon name={icon}/></Pressable>;
}
export function Field({id, label, ...props}: TextInputProps & {id: string; label: string}) {
  return <View style={s.fieldWrap}><Text testID={`${id}-label`} style={s.label}>{label}</Text><TextInput {...props} testID={id} accessibilityLabel={label} placeholderTextColor={colors.muted} style={[s.input, props.multiline && s.textarea, props.style]} /></View>;
}
export function Badge({id, label, gold = false}: {id: string; label: string; gold?: boolean}) {
  return <View testID={id} style={[s.badge, gold && s.goldBadge]}><Text style={[s.badgeText, gold && s.goldText]}>{label}</Text></View>;
}
export function ErrorNote({id = 'screen-error', text}: {id?: string; text: string}) {
  return text ? <View testID={id} accessibilityRole="alert" style={s.error}><Icon name="alert-circle-outline" color={colors.error}/><Text style={s.errorText}>{text}</Text></View> : null;
}
export function PageTitle({id, eyebrow, title, subtitle, action}: {id: string; eyebrow: string; title: string; subtitle?: string; action?: ReactNode}) {
  return <View style={s.titleWrap}><Text style={s.eyebrow} testID={`${id}-eyebrow`}>{eyebrow}</Text><View style={s.row}><Text testID={`${id}-title`} style={s.h1}>{title}</Text>{action}</View>{!!subtitle && <Text testID={`${id}-subtitle`} style={s.subtitle}>{subtitle}</Text>}</View>;
}
export function Empty({id, icon, title, detail, children}: {id: string; icon: IconName; title: string; detail: string; children?: ReactNode}) {
  return <View testID={id} style={s.empty}><View style={s.emptyIcon}><Icon name={icon} size={32} color={colors.brandSecondary}/></View><Text style={s.h2}>{title}</Text><Text style={[s.body, s.center]}>{detail}</Text>{children}</View>;
}
export function Sheet({id, title, onClose, children}: {id: string; title: string; onClose: () => void; children: ReactNode}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[s.backdrop, {paddingTop: insets.top + 16}]}>
        <View testID={id} style={[s.sheet, {paddingBottom: Math.max(insets.bottom, 20)}]}>
          <View style={s.handle}/>
          <View style={s.sheetHeader}>
            <Text testID={`${id}-title`} style={[s.h2, s.flex]}>{title}</Text>
            <IconButton id={`${id}-close`} label="Close" icon="close" onPress={onClose}/>
          </View>
          <ScrollView testID={`${id}-scroll`} style={s.sheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator contentContainerStyle={s.sheetContent}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function Chips({id, value, items, onChange}: {id: string; value: string; items: {value: string; label: string}[]; onChange: (v: string) => void}) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">{items.map(item => <Pressable key={item.value} testID={`${id}-${item.value || 'all'}`} accessibilityRole="button" accessibilityState={{selected: value === item.value}} onPress={() => onChange(item.value)} style={({pressed}) => [s.chip, value === item.value && s.chipSelected, pressed && s.pressed]}><Text style={[s.chipText, value === item.value && s.chipTextSelected]}>{item.label}</Text></Pressable>)}</ScrollView>;
}
export function Enter({children}: {children: ReactNode}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(opacity, {toValue: 1, duration: 280, useNativeDriver: Platform.OS !== 'web'}).start(); }, [opacity]);
  return <Animated.View style={[s.flex, {opacity, transform: [{translateY: opacity.interpolate({inputRange: [0,1], outputRange: [8,0]})}]}]}>{children}</Animated.View>;
}

export const s = StyleSheet.create({
  flex: {flex: 1}, screen: {flex: 1, backgroundColor: colors.surface}, content: {padding: 22, paddingBottom: 32, gap: 20}, row: {flexDirection: 'row', alignItems: 'center', gap: 12}, between: {justifyContent: 'space-between'},
  titleWrap: {gap: 8}, eyebrow: {fontSize: 11, letterSpacing: 2, fontWeight: '700', color: colors.brandSecondary}, h1: {fontSize: 32, lineHeight: 39, letterSpacing: -1, fontWeight: '700', color: colors.onSurface, flex: 1}, h2: {fontSize: 21, lineHeight: 28, fontWeight: '600', color: colors.onSurface}, h3: {fontSize: 17, lineHeight: 23, fontWeight: '600', color: colors.onSurface}, subtitle: {fontSize: 14, lineHeight: 21, color: colors.muted}, body: {fontSize: 15, lineHeight: 23, color: colors.onSurfaceSecondary}, caption: {fontSize: 12, lineHeight: 18, color: colors.muted}, center: {textAlign: 'center'},
  card: {backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.divider, borderRadius: 20, padding: 20, gap: 12}, button: {minHeight: 52, borderRadius: 14, backgroundColor: colors.brandSecondary, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center'}, buttonText: {fontSize: 15, fontWeight: '700', color: colors.onBrandSecondary, flexShrink: 1, textAlign: 'center'}, secondary: {backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border}, secondaryText: {color: colors.onSurface}, iconButton: {width: 46, height: 46, borderRadius: 14, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center'}, disabled: {opacity: 0.5}, pressed: {opacity: 0.75, transform: [{scale: 0.98}]},
  fieldWrap: {gap: 9}, label: {color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600'}, input: {minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 13, backgroundColor: colors.surface, color: colors.onSurface, fontSize: 16}, textarea: {minHeight: 100, textAlignVertical: 'top'},
  badge: {alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.brandTertiary}, badgeText: {fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: colors.onBrandTertiary}, goldBadge: {backgroundColor: colors.surfaceTertiary}, goldText: {color: colors.brandSecondary},
  error: {borderWidth: 1, borderColor: colors.error, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center'}, errorText: {color: colors.error, fontSize: 13, lineHeight: 19, flex: 1},
  empty: {alignItems: 'center', paddingVertical: 34, paddingHorizontal: 14, gap: 16, borderWidth: 1, borderColor: colors.divider, borderRadius: 20, backgroundColor: colors.surfaceSecondary}, emptyIcon: {width: 76, height: 76, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceTertiary, marginBottom: 4},
  backdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: colors.backdrop}, sheet: {flex: 1, maxHeight: '94%', minHeight: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 22}, sheetScroll: {flex: 1, minHeight: 0}, sheetContent: {paddingBottom: 16, gap: 20}, handle: {width: 36, height: 4, borderRadius: 4, backgroundColor: colors.borderStrong, alignSelf: 'center', marginVertical: 12}, sheetHeader: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20, flexShrink: 0},
  chips: {gap: 8, paddingVertical: 2}, chip: {minHeight: 44, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border}, chipSelected: {backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary}, chipText: {fontSize: 13, color: colors.muted, fontWeight: '600'}, chipTextSelected: {color: colors.onSurface}, line: {height: 1, backgroundColor: colors.divider},
});