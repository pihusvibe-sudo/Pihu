import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_ALIAS = "pihu_gemini_api_key_v1";

export type Msg = {
  role: "user" | "model";
  text: string;
  time: number;
};

export type Person = {
  id: string;
  name: string;
  photo: string;
  note: string;
};

export async function getKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY_ALIAS);
  } catch {
    return null;
  }
}

export async function putKey(value: string): Promise<void> {
  const clean = (value || "").trim();
  if (!clean) {
    await SecureStore.deleteItemAsync(KEY_ALIAS);
    return;
  }
  await SecureStore.setItemAsync(KEY_ALIAS, clean);
}

export async function load<T>(storageKey: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function save<T>(storageKey: string, value: T): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(value));
}
