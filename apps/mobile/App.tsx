// Root flow router. Status machine on the client mirrors the on-server reality:
//   loading       — still bootstrapping SecureStore
//   signedOut     — phone → otp
//   onboarding    — pick role(s) → (if worker) pick specialties → home
//   signedIn      — home
// We keep the routing here (rather than introducing react-navigation) until the screen
// surface grows large enough to need a real router — keeps the bootable shell tiny.

import { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { motion } from '@kafil/core';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { OutboxProvider } from './src/outbox/OutboxContext';
import { PhoneEntryScreen } from './src/screens/PhoneEntryScreen';
import { OtpScreen } from './src/screens/OtpScreen';
import { RoleScreen } from './src/screens/RoleScreen';
import { WorkerSpecialtiesScreen } from './src/screens/WorkerSpecialtiesScreen';
import { HomeScreen } from './src/screens/HomeScreen';

type AuthStep = 'phone' | 'otp';
type OnboardingStep = 'role' | 'worker_specialties' | 'done';

export default function App() {
  return (
    <AuthProvider>
      <OutboxProvider>
        <StatusBar style="auto" />
        <Flow />
      </OutboxProvider>
    </AuthProvider>
  );
}

function Flow() {
  const { status, api } = useAuth();
  const [authStep, setAuthStep] = useState<AuthStep>('phone');
  const [phoneForOtp, setPhoneForOtp] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(null);
  const [boundCheckDone, setBoundCheckDone] = useState(false);

  // When the user signs in: figure out if they already have a role + worker_profile.
  // If they do, skip onboarding entirely. If not, push them into role-pick.
  useEffect(() => {
    if (status !== 'signedIn') {
      setOnboardingStep(null);
      setBoundCheckDone(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await api.get<{ ok: true; user: { roles?: Array<{ role: string }>; workerProfile?: unknown } }>(
        '/api/auth/me',
      );
      if (cancelled) return;
      const u = (r.data as { user?: { roles?: Array<{ role: string }>; workerProfile?: unknown } }).user;
      const hasRole = !!u?.roles && u.roles.length > 0;
      if (!hasRole) {
        setOnboardingStep('role');
      } else {
        const isWorker = u!.roles!.some((x) => x.role === 'worker');
        // If they hold worker role but haven't picked specialties yet, route to that step.
        // Right now we approximate by checking if workerProfile exists (lazy-create at addRole).
        // A more precise check (specialty count > 0) comes when we add a /me/onboarding-status endpoint.
        if (isWorker && !u!.workerProfile) setOnboardingStep('worker_specialties');
        else setOnboardingStep('done');
      }
      setBoundCheckDone(true);
    })().catch(() => setBoundCheckDone(true));
    return () => {
      cancelled = true;
    };
  }, [status, api]);

  if (status === 'loading' || (status === 'signedIn' && !boundCheckDone)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={motion.color.primary} />
      </View>
    );
  }

  if (status === 'signedOut') {
    if (authStep === 'phone') {
      return (
        <PhoneEntryScreen
          onOtpSent={(phone) => {
            setPhoneForOtp(phone);
            setAuthStep('otp');
          }}
        />
      );
    }
    return (
      <OtpScreen
        phoneE164={phoneForOtp ?? ''}
        onBack={() => setAuthStep('phone')}
        onVerified={({ isNew }) => {
          // status flips to signedIn via context; the bound-check effect picks up onboarding.
          if (isNew) setOnboardingStep('role'); // optimistic — confirmed by the /me check
        }}
      />
    );
  }

  // signedIn
  if (onboardingStep === 'role') {
    return (
      <RoleScreen
        onDone={(choice) => {
          if (choice === 'employer') setOnboardingStep('done');
          else setOnboardingStep('worker_specialties');
        }}
      />
    );
  }
  if (onboardingStep === 'worker_specialties') {
    return <WorkerSpecialtiesScreen onDone={() => setOnboardingStep('done')} />;
  }
  // Hidden fallback while onboardingStep settles.
  if (onboardingStep === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={motion.color.primary} />
        <Text style={{ color: '#888', marginTop: 8 }}>Loading…</Text>
      </View>
    );
  }
  return <HomeScreen />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: motion.color.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
