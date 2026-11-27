import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  FlatList,
  Image,
  Alert,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { askGemini, visionGemini } from "./src/gemini";
import { getKey, putKey, load, save, Msg, Person } from "./src/store";
import { sendEspEmotion, connectHc05, sendRobotCommand } from "./src/hardware";

const bg = "#090D18",
  panel = "#121A2A",
  line = "#263650",
  white = "#F4F7FF",
  muted = "#9AAAC4",
  cyan = "#55D9F5",
  blue = "#4E7BFF";

type Tab = "Home" | "Chat" | "Vision" | "Memory" | "Settings";

const EMOTIONS = [
  "HAPPY",
  "SAD",
  "ANGRY",
  "EXCITED",
  "SHY",
  "JEALOUS",
  "LONELY",
  "CURIOUS",
  "CARING",
] as const;

export default function App() {
  const [tab, setTab] = useState<Tab>("Home");
  const [key, setKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [espIp, setEspIp] = useState("");
  const [btConnected, setBtConnected] = useState(false);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [memory, setMemory] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Ready");

  const [perm, askPerm] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [photo, setPhoto] = useState<any>(null);
  const [vision, setVision] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const cam = useRef<CameraView>(null);

  useEffect(() => {
    (async () => {
      const [k, m, h, p, savedIp] = await Promise.all([
        getKey(),
        load("pihu_memory", ""),
        load<Msg[]>("pihu_chat", []),
        load<Person[]>("pihu_people", []),
        load("pihu_esp_ip", ""),
      ]);
      setKey(k || "");
      setKeyInput(k || "");
      setMemory(m);
      setMsgs
