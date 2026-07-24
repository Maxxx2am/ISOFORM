import { ScrollView, StyleSheet, Text, View } from 'react-native';

/** Shared visual for both the render-error boundary and the global JS error
 * catcher — deliberately hardcoded colors, no theme/store dependency. */
export function FatalErrorScreen({ error, extra }: { error: Error; extra?: string | null }) {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>ISOFORM hit a startup error</Text>
        <Text style={styles.subtitle}>Screenshot this whole screen and send it back — this is exactly what&apos;s needed to fix it.</Text>
        <Text style={styles.label}>Error</Text>
        <Text style={styles.mono}>{String(error.message || error)}</Text>
        {error.stack ? (
          <>
            <Text style={styles.label}>Stack</Text>
            <Text style={styles.mono}>{error.stack}</Text>
          </>
        ) : null}
        {extra ? (
          <>
            <Text style={styles.label}>Component stack</Text>
            <Text style={styles.mono}>{extra}</Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  scroll: { padding: 20, paddingTop: 64, gap: 12 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#9A9AA1', fontSize: 14, marginBottom: 8 },
  label: { color: '#FF9F0A', fontSize: 12, fontWeight: '700', marginTop: 8, textTransform: 'uppercase' },
  mono: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Courier' },
});
