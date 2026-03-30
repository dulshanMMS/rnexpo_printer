import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import InvoicePrintScreen from './src/screens/InvoicePrintScreen';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

function AppContent() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="dark" />
      <InvoicePrintScreen />
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
