import React, { useEffect } from 'react';
import { StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Dashboard from './src/screens/Dashboard';
import { initDb } from './src/database/sqlite';
import { initializeSslPinning } from 'react-native-ssl-public-key-pinning';

export default function App() {
  useEffect(() => {
    try {
      initDb();
    } catch (err) {
      console.warn("Failed to initialize sqlite db on app startup", err);
    }

    if (Platform.OS !== 'web') {
      try {
        const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://aura-fitness-backend.vercel.app';
        if (backendUrl.startsWith('https://')) {
          const hostname = backendUrl.replace('https://', '').split('/')[0].split(':')[0];
          initializeSslPinning({
            [hostname]: {
              includeSubdomains: true,
              publicKeyHashes: [
                'ft9JFh9fyiSD0LI4vCAyVHDM1OKStfDBooxsWHHvngY=', // Vercel edge certificate leaf hash
                'mDixV3KPpC3fR5yJ9Wiy9RYfk9Qi5WtntP2ZBrP6vgk='  // Vercel backup public key hash
              ],
            },
          });
          console.log(`[Aura Client] Native SSL Pinning successfully initialized for ${hostname}.`);
        } else {
          console.log("[Aura Client] HTTP connection detected. Skipping SSL Pinning.");
        }
      } catch (pinErr) {
        console.warn("Failed to initialize SSL certificate pinning", pinErr);
      }
    }
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <Dashboard />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0A0E17',
  },
});
