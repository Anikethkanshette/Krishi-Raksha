import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/src/theme";

let listener: ((message: string) => void) | null = null;

export function showToast(message: string) {
  listener?.(message);
}

export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    listener = (next) => {
      setMessage(next);
      setVisible(true);
    };
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 3400);
    return () => clearTimeout(timer);
  }, [visible, message]);

  if (!visible) return null;
  return (
    <Pressable
      testID="toast-message"
      onPress={() => setVisible(false)}
      style={[styles.toast, { bottom: insets.bottom + 96, backgroundColor: colors.surfaceInverse }]}
    >
      <Text style={[styles.text, { color: colors.onSurfaceInverse }]}>{message}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 20,
    right: 20,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  text: { fontSize: 13, fontWeight: "700", textAlign: "center", lineHeight: 18 },
});
