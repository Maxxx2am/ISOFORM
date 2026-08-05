import { type ViewStyle, StyleSheet, useWindowDimensions, View } from 'react-native';
import Body, { type ExtendedBodyPart, type Slug } from 'react-native-body-highlighter';

import type { Muscle } from '@/exercises/types';
import { useProfile } from '@/store/profile';

import { muscleToBackSlugs, muscleToFrontSlugs } from './muscleSlugMap';

type Props = { muscles: Muscle[]; style?: ViewStyle };

const GHOST_FILL = '#5e5e6633';

const INTENSITY_COLORS = ['#82f300', '#87918A', '#6E7771', '#555B58'];

const HIDDEN_PARTS: Slug[] = ['head', 'hair'];

const BODY_WIDTH = 200;

function buildData(
  muscles: Muscle[],
  map: Partial<Record<Muscle, Slug[]>>,
): ExtendedBodyPart[] {
  const result: ExtendedBodyPart[] = [];
  const seen = new Set<Slug>();
  muscles.forEach((muscle, index) => {
    const slugs = map[muscle] ?? [];
    const intensity = Math.min(index + 1, INTENSITY_COLORS.length);
    slugs.forEach((slug) => {
      if (seen.has(slug)) return;
      seen.add(slug);
      result.push({ slug, intensity });
    });
  });
  return result;
}

export function MuscleDiagrams({ muscles, style }: Props) {
  const { sex } = useProfile();
  const { width: screenWidth } = useWindowDimensions();
  const gender: 'male' | 'female' = sex === 'female' ? 'female' : 'male';

  const maxBodyWidth = (screenWidth - 28) / 2;
  const scale = Math.min(0.95, maxBodyWidth / BODY_WIDTH);

  const frontData = buildData(muscles, muscleToFrontSlugs);
  const backData = buildData(muscles, muscleToBackSlugs);

  const body = (side: 'front' | 'back', data: ExtendedBodyPart[]) => (
    <View style={styles.bodyWrapper}>
      <Body
        data={data}
        colors={INTENSITY_COLORS}
        gender={gender}
        side={side}
        scale={scale}
        border="none"
        defaultFill={GHOST_FILL}
        hiddenParts={HIDDEN_PARTS}
      />
    </View>
  );

  return (
    <View style={[styles.row, { marginTop: -40 * scale }, style]}>
      {body('front', frontData)}
      {body('back', backData)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 2,
    overflow: 'visible',
  },
  bodyWrapper: {
    alignItems: 'center',
    overflow: 'visible',
  },
});
