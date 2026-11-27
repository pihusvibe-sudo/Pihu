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
      setMsgs(h);
      setPeople(p);
      setEspIp(savedIp);
    })();
  }, []);

  useSpeechRecognitionEvent("start", () => {
    setListening(true);
    setStatus("Listening…");
  });
  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    setStatus("Ready");
  });
  useSpeechRecognitionEvent("result", (e) => {
    const t = e.results?.[0]?.transcript || "";
    if (e.isFinal && t) setInput(t);
  });
  useSpeechRecognitionEvent("error", (e) => {
    setListening(false);
    setStatus(e.message || "Voice unavailable");
  });

  const say = (t: string) =>
    Speech.speak(t, {
      language: /[\u0900-\u097F]/.test(t) ? "hi-IN" : "en-IN",
      rate: 0.96,
    });

  const detectEmotion = (text: string): string => {
    const upper = text.toUpperCase();
    for (const emo of EMOTIONS) {
      if (upper.includes(emo)) return emo;
    }
    return "HAPPY";
  };

  const syncHardware = async (emotion: string, moveCmd: string = "S") => {
    const connTag = btConnected ? "BT_OK" : "NO_BT";
    await sendEspEmotion(espIp, emotion, connTag, moveCmd);
    if (btConnected) {
      await sendRobotCommand(moveCmd);
    }
  };

  const handleDrive = async (cmd: string) => {
    setStatus(`Drive: ${cmd}`);
    await syncHardware("EXCITED", cmd);
  };

  const send = async (text = input) => {
    const q = text.trim();
    if (!q || busy) return;
    const user: Msg = { role: "user", text: q, time: Date.now() };
    const next = [...msgs, user];
    setMsgs(next);
    setInput("");
    await save("pihu_chat", next);
    setBusy(true);
    setStatus("Thinking…");

    try {
      const prompt = `Reply as Pihu, a warm AI companion robot. Mention one emotion keyword from [HAPPY, SAD, ANGRY, EXCITED, SHY, JEALOUS, LONELY, CURIOUS, CARING] naturally.\n${
        memory ? "User memory: " + memory + "\n" : ""
      }${q}`;
      const answer = await askGemini(key, prompt, msgs);
      const all = [...next, { role: "model" as const, text: answer, time: Date.now() }];
      setMsgs(all);
      await save("pihu_chat", all);

      const emotion = detectEmotion(answer);
      await syncHardware(emotion, "S");
      say(answer);
      setStatus("Ready");
    } catch (e: any) {
      const all = [
        ...next,
        { role: "model" as const, text: "Pihu: " + (e.message || "Request failed"), time: Date.now() },
      ];
      setMsgs(all);
      await save("pihu_chat", all);
      setStatus("Check settings");
    } finally {
      setBusy(false);
    }
  };

  const mic = async () => {
    try {
      const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!p.granted) throw new Error("Microphone permission denied");
      ExpoSpeechRecognitionModule.start({
        lang: "hi-IN",
        interimResults: true,
        continuous: false,
      });
    } catch (e: any) {
      Alert.alert("Voice input", e.message);
    }
  };

  const capture = async () => {
    try {
      const p = await cam.current?.takePictureAsync({ quality: 0.6, base64: true });
      if (!p?.base64) throw new Error("No image captured");
      setPhoto(p);
      setVision("Photo captured.");
    } catch (e: any) {
      Alert.alert("Camera", e.message);
    }
  };

  const analyze = async () => {
    if (!photo?.base64) return Alert.alert("Capture a photo first");
    setBusy(true);
    try {
      const a = await visionGemini(key, photo.base64);
      setVision(a);
      await syncHardware("CURIOUS", "S");
      say(a);
    } catch (e: any) {
      setVision(e.message);
    } finally {
      setBusy(false);
    }
  };

  const savePerson = async () => {
    if (!name.trim() || !photo?.uri) return Alert.alert("Add a name and capture a photo");
    const p = [...people, { id: String(Date.now()), name: name.trim(), photo: photo.uri, note }];
    setPeople(p);
    await save("pihu_people", p);
    setName("");
    setNote("");
    Alert.alert(
      "Saved",
      "Photo profile saved locally. Automatic biometric face matching is not included in this version."
    );
  };

  const Button = ({ label, onPress, alt = false }: any) => (
    <Pressable
      onPress={onPress}
      style={[s.button, alt && { backgroundColor: "#1A2941", borderWidth: 1, borderColor: line }]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
  const Card = ({ children }: any) => <View style={s.card}>{children}</View>;
  const title = (t: string, sub: string) => (
    <View style={{ gap: 5, marginBottom: 8 }}>
      <Text style={s.title}>{t}</Text>
      <Text style={s.muted}>{sub}</Text>
    </View>
  );

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <View style={s.top}>
        <Text style={s.brand}>
          PIHU <Text style={{ color: "#D6AE62" }}>AI</Text>
        </Text>
        <Text style={s.muted}>{btConnected ? "HC-05 LINKED" : "HARDWARE MODE"}</Text>
      </View>

      <View style={{ flex: 1 }}>
        {tab === "Home" && (
          <ScrollView contentContainerStyle={s.page}>
            {title("Your AI companion", "Phone brain + ESP8266 face + UNO drive + AT110ML audio")}
            <Card>
              <View style={s.face}>
                <View style={{ flexDirection: "row", gap: 34 }}>
                  <View style={s.eye} />
                  <View style={s.eye} />
                </View>
                <View style={s.smile} />
              </View>
              <Text style={s.hero}>Hey, I'm Pihu!</Text>
              <Text style={s.muted}>{status}</Text>
            </Card>
            <View style={s.grid}>
              {(["Chat", "Vision", "Memory", "Settings"] as Tab[]).map((t) => (
                <Pressable key={t} style={s.tile} onPress={() => setTab(t)}>
                  <Text style={{ color: cyan, fontSize: 22 }}>
                    {t === "Chat" ? "◉" : t === "Vision" ? "◎" : t === "Memory" ? "▤" : "⚙"}
                  </Text>
                  <Text style={s.tileText}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <Card>
              <Text style={s.cardTitle}>Robot motion controls (HC-05)</Text>
              <Text style={s.muted}>
                Sends F, B, L, R, S over HC-05 and updates ESP8266 movement status.
              </Text>
              <View style={s.row}>
                <Button label="↑ Forward" alt onPress={() => handleDrive("F")} />
                <Button label="STOP" onPress={() => handleDrive("S")} />
              </View>
              <View style={s.row}>
                <Button label="← Left" alt onPress={() => handleDrive("L")} />
                <Button label="Right →" alt onPress={() => handleDrive("R")} />
                <Button label="↓ Back" alt onPress={() => handleDrive("B")} />
              </View>
            </Card>
          </ScrollView>
        )}

        {tab === "Chat" && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.pad}>{title("Chat with Pihu", "Hindi · English · Hinglish")}</View>
            <FlatList
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              data={msgs}
              keyExtractor={(m, i) => m.time + "-" + i}
              renderItem={({ item }) => (
                <View
                  style={[
                    s.bubble,
                    item.role === "user"
                      ? { alignSelf: "flex-end", backgroundColor: "#243D70" }
                      : { alignSelf: "flex-start", backgroundColor: panel },
                  ]}
                >
                  <Text style={s.msg}>{item.text}</Text>
                  {item.role === "model" && (
                    <Text style={{ color: cyan }} onPress={() => say(item.text)}>
                      ▶ Speak
                    </Text>
                  )}
                </View>
              )}
              ListEmptyComponent={<Text style={s.muted}>Say hello to begin.</Text>}
            />
            {busy && <ActivityIndicator color={cyan} />}
            <View style={s.composer}>
              <Pressable
                onPress={listening ? () => ExpoSpeechRecognitionModule.stop() : mic}
                style={s.mic}
              >
                <Text style={{ fontSize: 19 }}>{listening ? "■" : "🎙"}</Text>
              </Pressable>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Message Pihu…"
                placeholderTextColor={muted}
                style={s.input}
              />
              <Pressable onPress={() => send()} style={s.send}>
                <Text style={{ color: white, fontSize: 20 }}>➤</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}

        {tab === "Vision" && (
          <ScrollView contentContainerStyle={s.page}>
            {title("Pihu Vision", "Camera-based scene understanding")}
            {!perm?.granted ? (
              <Card>
                <Text style={s.cardTitle}>Camera permission needed</Text>
                <Button label="Allow camera" onPress={askPerm} />
              </Card>
            ) : (
              <View style={{ height: 330, borderRadius: 18, overflow: "hidden" }}>
                <CameraView ref={cam} style={{ flex: 1 }} facing={facing} />
                <View style={[s.row, { position: "absolute", bottom: 10, alignSelf: "center" }]}>
                  <Button label="Capture" onPress={capture} />
                  <Button
                    label="Flip"
                    alt
                    onPress={() => setFacing(facing === "back" ? "front" : "back")}
                  />
                </View>
              </View>
            )}
            <Card>
              <Text style={s.cardTitle}>Understand the scene</Text>
              <Text style={s.muted}>
                Captured photo is sent to Gemini for description. Do not use this to identify people.
              </Text>
              <Button label="Analyze photo" onPress={analyze} />
              {busy && <ActivityIndicator color={cyan} />}
              <Text style={s.msg}>{vision}</Text>
            </Card>
            <Card>
              <Text style={s.cardTitle}>Save person photo profile</Text>
              <Text style={s.muted}>
                Stores a named photo locally. Automatic biometric face matching is not in v1.0.
              </Text>
              {photo?.uri && (
                <Image source={{ uri: photo.uri }} style={{ width: 90, height: 90, borderRadius: 14 }} />
              )}
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Person's name"
                placeholderTextColor={muted}
                style={s.input}
              />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Optional note"
                placeholderTextColor={muted}
                style={s.input}
              />
              <Button label="Save profile" onPress={savePerson} />
            </Card>
          </ScrollView>
        )}

        {tab === "Memory" && (
          <ScrollView contentContainerStyle={s.page}>
            {title("Pihu Memory", "Saved on this phone")}
            <Card>
              <Text style={s.cardTitle}>Personal memory notes</Text>
              <TextInput
                value={memory}
                onChangeText={setMemory}
                multiline
                placeholder="My name is… I like… My current project is…"
                placeholderTextColor={muted}
                style={[s.input, { height: 120, textAlignVertical: "top" }]}
              />
              <Button
                label="Save memory"
                onPress={async () => {
                  await save("pihu_memory", memory);
                  Alert.alert("Saved", "Memory saved on this phone.");
                }}
              />
            </Card>
            <Card>
              <Text style={s.cardTitle}>People ({people.length})</Text>
              {people.map((p) => (
                <View key={p.id} style={s.row}>
                  {p.photo ? (
                    <Image source={{ uri: p.photo }} style={{ width: 46, height: 46, borderRadius: 10 }} />
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={s.msg}>{p.name}</Text>
                    <Text style={s.muted}>{p.note}</Text>
                  </View>
                  <Text
                    style={{ color: "#FF6B78" }}
                    onPress={async () => {
                      const n = people.filter((x) => x.id !== p.id);
                      setPeople(n);
                      await save("pihu_people", n);
                    }}
                  >
                    Delete
                  </Text>
                </View>
              ))}
              {!people.length && <Text style={s.muted}>No profiles yet.</Text>}
            </Card>
            <Card>
              <Text style={s.cardTitle}>Chat history</Text>
              <Text style={s.muted}>{msgs.length} messages saved.</Text>
              <Button
                label="Clear chat"
                alt
                onPress={() =>
                  Alert.alert("Clear chat?", "This cannot be undone.", [
                    { text: "Cancel" },
                    {
                      text: "Clear",
                      onPress: async () => {
                        setMsgs([]);
                        await save("pihu_chat", []);
                      },
                    },
                  ])
                }
              />
            </Card>
          </ScrollView>
        )}

        {tab === "Settings" && (
          <ScrollView contentContainerStyle={s.page}>
            {title("Settings", "Configure Pihu's AI brain & hardware links")}
            <Card>
              <Text style={s.cardTitle}>ESP8266 TFT IP Address</Text>
              <TextInput
                value={espIp}
                onChangeText={async (v) => {
                  setEspIp(v);
                  await save("pihu_esp_ip", v);
                }}
                placeholder="e.g. 192.168.43.120"
                placeholderTextColor={muted}
                style={s.input}
              />
              <Button label="Test ESP Face" onPress={() => syncHardware("EXCITED", "S")} />
            </Card>
            <Card>
              <Text style={s.cardTitle}>Arduino HC-05 Bluetooth</Text>
              <Button
                label={btConnected ? "HC-05 Connected" : "Connect HC-05"}
                onPress={async () => {
                  const ok = await connectHc05("HC-05");
                  setBtConnected(ok);
                  Alert.alert(
                    ok ? "Connected" : "Not Connected",
                    ok ? "Connected to HC-05." : "Pair HC-05 in Android Bluetooth settings first."
                  );
                }}
              />
            </Card>
            <Card>
              <Text style={s.cardTitle}>Gemini API key</Text>
              <Text style={s.muted}>
                Paste your key. Stored with Android SecureStore. Personal prototype only; a public app needs a protected backend.
              </Text>
              <TextInput
                value={keyInput}
                onChangeText={setKeyInput}
                secureTextEntry
                autoCapitalize="none"
                placeholder="Gemini API key"
                placeholderTextColor={muted}
                style={s.input}
              />
              <Button
                label="Save API key"
                onPress={async () => {
                  await putKey(keyInput);
                  setKey(keyInput);
                  Alert.alert("Saved", "API key saved securely on this device.");
                }}
              />
              <Text style={{ color: key ? "#62D6A4" : "#FFB86B" }}>
                {key ? "● API key saved" : "○ API key not configured"}
              </Text>
            </Card>
          </ScrollView>
        )}
      </View>

      <View style={s.nav}>
        {(["Home", "Chat", "Vision", "Memory", "Settings"] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, alignItems: "center", gap: 3 }}>
            <Text style={{ color: tab === t ? cyan : muted, fontSize: 12, fontWeight: "800" }}>
              {t === "Home" ? "⌂" : t === "Chat" ? "◉" : t === "Vision" ? "◎" : t === "Memory" ? "▤" : "⚙"}
            </Text>
            <Text style={{ color: tab === t ? cyan : muted, fontSize: 10 }}>{t}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: bg },
  top: {
    height: 54,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderColor: line,
  },
  brand: { fontSize: 21, fontWeight: "900", letterSpacing: 2, color: white },
  muted: { color: muted, fontSize: 12, lineHeight: 18 },
  page: { padding: 15, gap: 13, paddingBottom: 25 },
  pad: { padding: 15 },
  title: { fontSize: 23, fontWeight: "900", color: white },
  card: { backgroundColor: panel, borderWidth: 1, borderColor: line, borderRadius: 18, padding: 15, gap: 10 },
  face: {
    height: 110,
    width: 165,
    alignSelf: "center",
    backgroundColor: "#050A14",
    borderColor: cyan,
    borderWidth: 2,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  eye: { width: 23, height: 28, borderRadius: 15, backgroundColor: cyan },
  smile: { width: 28, height: 10, borderBottomWidth: 3, borderColor: cyan, borderRadius: 20 },
  hero: { color: white, fontSize: 22, fontWeight: "900", textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: panel,
    borderWidth: 1,
    borderColor: line,
    borderRadius: 16,
    padding: 16,
    gap: 7,
  },
  tileText: { color: white, fontWeight: "800" },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  button: { backgroundColor: blue, padding: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", flex: 1 },
  buttonText: { color: white, fontSize: 12, fontWeight: "800" },
  bubble: { padding: 13, borderRadius: 16, maxWidth: "88%", gap: 8 },
  msg: { color: white, fontSize: 14, lineHeight: 21 },
  composer: { flexDirection: "row", alignItems: "center", padding: 10, gap: 8, borderTopWidth: 1, borderColor: line },
  mic: { width: 45, height: 45, borderRadius: 14, backgroundColor: "#1A2941", alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    minHeight: 45,
    backgroundColor: "#182338",
    borderWidth: 1,
    borderColor: line,
    borderRadius: 12,
    padding: 11,
    color: white,
  },
  send: { width: 45, height: 45, borderRadius: 14, backgroundColor: blue, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: white, fontSize: 16, fontWeight: "800" },
  nav: { height: 62, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderColor: line, backgroundColor: "#0D1422" },
});
