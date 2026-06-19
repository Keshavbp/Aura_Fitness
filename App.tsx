import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Dashboard from './src/screens/Dashboard';
import { initDb } from './src/database/sqlite';

export default function App() {
  useEffect(() => {
    try {
      initDb();
    } catch (err) {
      console.warn("Failed to initialize sqlite db on app startup", err);
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
