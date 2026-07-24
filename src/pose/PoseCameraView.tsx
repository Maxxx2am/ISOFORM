import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { POSE_HTML } from '@/pose/poseHtml';
import type { PoseFrame } from '@/pose/types';

export type PoseCameraHandle = {
  /** Stop recording and flush the video; resolves the pending onVideo message. */
  finish: () => void;
};

type PoseCameraViewProps = {
  onFrame: (frame: PoseFrame) => void;
  /** Human-readable status ("Loading model", "" when ready). */
  onStatus?: (status: string) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  /** Recorded clip as base64 (null if recording unavailable), with pixel size. */
  onVideo?: (base64: string | null, mime: string, w: number, h: number) => void;
  /** 'front' (default) or 'back' camera. */
  facing?: 'front' | 'back';
  /** Draw only arms + torso + head in the live skeleton (skip glitchy legs). */
  hideLegs?: boolean;
  /** Draw a single clean line down the visible side (side-view exercises). */
  sideView?: boolean;
  /** Draw a horizontal line at the bar (wrist height) — for pull-ups. */
  showBar?: boolean;
};

type Msg =
  | { type: 'landmarks'; t: number; landmarks: { x: number; y: number; z: number; visibility: number }[] }
  | { type: 'status'; value: string }
  | { type: 'ready' }
  | { type: 'error'; where: string; message: string }
  | { type: 'video'; data: string | null; mime?: string; w?: number; h?: number };

/**
 * Real on-device pose in Expo Go: a WebView runs MediaPipe Pose Landmarker
 * (see poseHtml.ts), streams 33-landmark frames here, and records the clip.
 * Loaded with an https baseUrl so getUserMedia has a secure context.
 */
export const PoseCameraView = forwardRef<PoseCameraHandle, PoseCameraViewProps>(
  ({ onFrame, onStatus, onReady, onError, onVideo, facing = 'front', hideLegs = false, sideView = false, showBar = false }, ref) => {
    const webRef = useRef<WebView>(null);

    useImperativeHandle(ref, () => ({
      finish: () => webRef.current?.injectJavaScript('window.__finish && window.__finish(); true;'),
    }));

    const handleMessage = useCallback(
      (e: WebViewMessageEvent) => {
        let msg: Msg;
        try {
          msg = JSON.parse(e.nativeEvent.data) as Msg;
        } catch {
          return;
        }
        switch (msg.type) {
          case 'landmarks':
            onFrame({ landmarks: msg.landmarks, t: msg.t, source: 'mediapipe' });
            break;
          case 'status':
            onStatus?.(msg.value);
            break;
          case 'ready':
            onReady?.();
            break;
          case 'error':
            onError?.(`${msg.where}: ${msg.message}`);
            break;
          case 'video':
            onVideo?.(msg.data, msg.mime ?? 'video/mp4', msg.w ?? 0, msg.h ?? 0);
            break;
        }
      },
      [onFrame, onStatus, onReady, onError, onVideo],
    );

    return (
      <WebView
        ref={webRef}
        style={styles.web}
        source={{ html: POSE_HTML, baseUrl: 'https://localhost' }}
        injectedJavaScriptBeforeContentLoaded={`window.__facing='${facing === 'back' ? 'environment' : 'user'}';window.__hideLegs=${hideLegs ? 'true' : 'false'};window.__sideView=${sideView ? 'true' : 'false'};window.__showBar=${showBar ? 'true' : 'false'};true;`}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        onMessage={handleMessage}
        onError={(e) => onError?.(e.nativeEvent.description || 'WebView failed to load')}
        allowsProtectedMedia
      />
    );
  },
);

PoseCameraView.displayName = 'PoseCameraView';

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#000000' },
});
