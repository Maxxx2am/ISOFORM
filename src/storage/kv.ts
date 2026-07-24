/**
 * Key-value storage adapter for zustand persistence.
 *
 * Uses AsyncStorage so the app runs in Expo Go (the free QR-code client) — MMKV
 * is faster but is a native module Expo Go doesn't bundle. zustand's persist
 * middleware supports an async StateStorage, so this is a drop-in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

export const zustandKvStorage: StateStorage = {
  getItem: (name) => AsyncStorage.getItem(name),
  setItem: (name, value) => AsyncStorage.setItem(name, value),
  removeItem: (name) => AsyncStorage.removeItem(name),
};
