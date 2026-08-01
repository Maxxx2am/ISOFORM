// @ts-nocheck
import * as FileSystem from 'expo-file-system/legacy';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ANALYZE_HTML } from '@/pose/analyzeHtml';
import type { PoseFrame } from '@/pose/types';

export type AnalyzeVideoHandle = {
  /** Reads the local video file, streams it into the WebView, and starts playback/analysis. */
  loadAndAnalyze: (fileUri: string, mime?: string) => Promise<void>;
};

type AnalyzeVideoViewProps = {
  onFrame: (frame: PoseFrame) => void;
  onStatus?: (status: string) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  /** Playback progress, 0..1, and video dimensions once known. */
  onProgress?: (t: number, duration: number) => void;
  onDims?: (w: number, h: number) => void;
  onDone?: () => void;
  hideLegs?: boolean;
  sideView?: boolean;
  showBar?: boolean;
  mirror?: boolean;
};

type Msg =
  | { type: 'landmarks'; t: number; landmarks: { x: number; y: number; z: number; visibility: number }[] }
  | { type: 'status'; value: string }
  | { type: 'ready' }
  | { type: 'error'; where: string; message: string }
  | { type: 'dims'; w: number; h: number; duration: number }
  | { type: 'progress'; t: number; duration: number }
  | { type: 'done' };

// Base64 chars per injectJavaScript call — keeps each RN->WebView bridge
// message small so it doesn't stall or get dropped on lower-end devices.
const CHUNK_SIZE = 250_000;
/** Refuse anything bigger than this on-disk — keeps the in-WebView base64
 * rebuild (atob + Blob) from stalling the analysis for minutes. */
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

/**
 * Feeds a video FILE (picked from the phone's library) through the same
 * MediaPipe pose pipeline used for the live camera, so an imported clip gets
 * skeleton + rep/hold tracking exactly like a live set. See analyzeHtml.ts.
 */
export const AnalyzeVideoView = forwardRef<AnalyzeVideoHandle, AnalyzeVideoViewProps>(
  ({ onFrame, onStatus, onReady, onError, onProgress, onDims, onDone, hideLegs = false, sideView = false, showBar = false, mirror = false }, ref) => {
    const webRef = useRef<WebView>(null);

    useImperativeHandle(ref, () => ({
      loadAndAnalyze: async (fileUri: string, mime = 'video/mp4') => {
        const info = await FileSystem.getInfoAsync(fileUri);
        if (!info.exists) throw new Error('Video file not found');
        if ((info.size ?? 0) > MAX_VIDEO_BYTES) {
          throw new Error(`Video is too large to analyze (max ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB)`);
        }
        onStatus?.('Reading video');
        const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
        onStatus?.('Sending to analyzer');
        for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
          const chunk = base64.slice(i, i + CHUNK_SIZE);
          webRef.current?.injectJavaScript(`window.__push(${JSON.stringify(chunk)});true;`);
          // Yield a tick between chunks so the bridge doesn't choke on a burst.
          await new Promise((r) => setTimeout(r, 0));
        }
        webRef.current?.injectJavaScript(`window.__run(${JSON.stringify(mime)});true;`);
      },
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
          case 'dims':
            onDims?.(msg.w, msg.h);
            break;
          case 'progress':
            onProgress?.(msg.t, msg.duration);
            break;
          case 'done':
            onDone?.();
            break;
        }
      },
      [onFrame, onStatus, onReady, onError, onProgress, onDims, onDone],
    );

    return (
      <WebView
        ref={webRef}
        style={styles.web}
        source={{ html: ANALYZE_HTML, baseUrl: 'https://localhost' }}
        injectedJavaScriptBeforeContentLoaded={`window.__hideLegs=${hideLegs ? 'true' : 'false'};window.__sideView=${sideView ? 'true' : 'false'};window.__showBar=${showBar ? 'true' : 'false'};window.__mirror=${mirror ? 'true' : 'false'};true;`}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        onMessage={handleMessage}
        onError={(e) => onError?.(e.nativeEvent.description || 'WebView failed to load')}
      />
    );
  },
);

AnalyzeVideoView.displayName = 'AnalyzeVideoView';

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#000000' },
});
