import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from '@/src/auth';
import Welcome from '@/src/screens/Welcome';
import { s } from '@/src/ui';
import { colors } from '@/src/theme';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  // One app level ErrorBoundary; a render crash shows a reload screen
  // instead of a blank app.
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <KeyboardProvider>
          <AuthProvider><StatusBar style="light"/><AuthGate /></AuthProvider>
        </KeyboardProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function AuthGate() {
  const {user, loading} = useAuth();
  if (loading) return <View testID="auth-loading" style={[s.screen, {justifyContent: 'center', alignItems: 'center', gap: 16}]}><ActivityIndicator color={colors.brandSecondary}/><Text style={s.body}>Preparing your private farm space…</Text></View>;
  return user ? <Stack key={user.user_id} screenOptions={{headerShown: false}}/> : <Welcome/>;
}
