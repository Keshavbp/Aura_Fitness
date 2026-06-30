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
        initializeSslPinning({
          'aura-fitness-backend.vercel.app': {
            includeSubdomains: true,
            publicKeyHashes: [
              '9k72J33bB72F4w3e9X2Y3Z4c5d6e7f8g9h0i1j2k3l4=',
              'bA9a8a7a6a5a4a3a2a1a0a9a8a7a6a5a4a3a2a1a0a0='
            ],
          },
        });
        console.log("[Aura Client] Native SSL Pinning successfully initialized.");
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
