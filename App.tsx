import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Animated,
  Easing,
  BackHandler,
  Alert,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Speech from "expo-speech";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import {
  getKey,
  putKey,
  load,
  save,
  Msg,
  Person,
} from "./src/store";
import {
  askGeminiStructured,
  EmotionTag,
  RobotAction,
} from "./src/gemini";
import { sendEspEmotion, connectHc05, sendRobotCommand } from "./src/hardware";

type Mode = "HOME" | "CHAT" | "ADVANCED" | "MEMORIES" | "PEOPLE" | "SETTINGS";

export default function App() {
  const [mode, setMode] = useState<Mode>("HOME");
  const [apiKey, setApiKey] = useState("");
  const [espIp, setEspIp] = useState("192.168.4.1");
  const [btConnected, setBtConnected] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<EmotionTag>("HAPPY");
  const [activeModel, setActiveModel] = useState<string>("");
  const [memoryText, setMemoryText] = useState("");
  const [people, setPeople] = useState<Person[]>([]);

  // Advanced Mode State
  const [permission, requestPermission] = useCameraPermissions();
  const [isListening, setIsListening] = useState(false);
  const cameraRef = useRef<any>(null);

  // Live Animated Face (Eye Blink & Scale Pulse)
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Handle Hardware Back Button for Navigation
  useEffect(() => {
    const backAction = () => {
      if (mode !== "HOME") {
        setMode("HOME");
        return true;
      }
      return false;
    };
    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );
    return () => backHandler.remove();
  }, [mode]);

  // Load Saved Configuration on Startup
  useEffect(() => {
    (async () => {
      const k = await getKey();
      if (k) setApiKey(k);
      const savedIp = await load<string>("pihu_esp_ip", "192.168.4.1");
      setEspIp(savedIp);
      const savedMem = await load<string>("pihu_memory", "");
      setMemoryText(savedMem);
      const savedPeople = await load<Person[]>("pihu_people", []);
      setPeople(savedPeople);
    })();
  }, []);

  // Continuous Eye Blink & Face Motion Animation Loop
  useEffect(() => {
    const blinkLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, {
          toValue: 0.1,
          duration: 150,
          useNativeDriver: true,
          easing: Easing.linear,
        }),
        Animated.timing(blinkAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
          easing: Easing.linear,
        }),
        Animated.delay(3500),
      ])
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.06,
          duration: 1200,
          useNativeDriver: true,
          easing: Easing.ease,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
          easing: Easing.ease,
        }),
      ])
    );

    blinkLoop.start();
    pulseLoop.start();

    return () => {
      blinkLoop.stop();
      pulseLoop.stop();
    };
  }, [blinkAnim, pulseAnim]);

  // Sync Emotion and Movement to Hardware (ESP8266 & Arduino UNO)
  const syncHardware = async (emotion: EmotionTag, move: RobotAction) => {
    setCurrentEmotion(emotion);
    if (espIp) {
      await sendEspEmotion(espIp, emotion);
    }
    if (move) {
      await sendRobotCommand(move);
    }
  };

  // Process Pihu Interaction (Text/Voice/Vision)
  const processQuery = async (prompt: string, imageBase64?: string) => {
    if (!prompt.trim() && !imageBase64) return;
    if (!apiKey.trim()) {
      Alert.alert("API Key Required", "Please enter your Gemini API key in Settings.");
      setMode("SETTINGS");
      return;
    }

    const userMsg: Msg = { role: "user", text: prompt || "[Camera Frame]", time: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await askGeminiStructured(
        apiKey,
        prompt || "Describe this scene and talk to me as Pihu.",
        messages,
        memoryText,
        imageBase64
      );

      const botMsg: Msg = { role: "model", text: res.reply, time: Date.now() };
      setMessages((prev) => [...prev, botMsg]);
      if (res.modelUsed) setActiveModel(res.modelUsed);

      // Hardware Sync & Speech Output
      await syncHardware(res.emotion, res.move);
      Speech.speak(res.reply, { language: "hi-IN" });
    } catch (e: any) {
      const errText = e?.message || "Communication error";
      setMessages((prev) => [
        ...prev,
        { role: "model", text: `Error: ${errText}`, time: Date.now() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Advanced Mode Camera Capture & Query
  const captureAndProcess = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.5,
        });
        if (photo?.base64) {
          await processQuery(inputText, photo.base64);
          setInputText("");
        }
      } catch (err) {
        Alert.alert("Camera Error", "Failed to capture frame from camera.");
      }
    }
  };

  // Voice Command Listener
  const startSpeechToText = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionAsync();
      if (!result.granted) {
        Alert.alert("Permission Error", "Microphone access is required for voice commands.");
        return;
      }
      setIsListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: "hi-IN",
        interimResults: false,
        maxAlternatives: 1,
      });
      ExpoSpeechRecognitionModule.addListener("result", (event: any) => {
        const text = event.results?.[0]?.transcript;
        if (text) {
          setInputText(text);
          processQuery(text);
        }
        setIsListening(false);
      });
    } catch (e) {
      setIsListening(false);
    }
  };

  // Render Top Header with Back Navigation
  const renderHeader = (title: string) => (
    <View style={styles.headerRow}>
      {mode !== "HOME" && (
        <TouchableOpacity style={styles.backBtn} onPress={() => setMode("HOME")}>
          <Text style={styles.backBtnText}>‹ Back</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.headerTitle}>{title}</Text>
      {activeModel ? <Text style={styles.modelTag}>{activeModel}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* HOME MODE — Visual Interactive Face & Dashboard */}
      {mode === "HOME" && (
        <View style={styles.homeContainer}>
          <Text style={styles.title}>PIHU AI COMPANION</Text>
          <Text style={styles.statusText}>
            Status: {btConnected ? "BT Connected" : "BT Disconnected"} | IP: {espIp}
          </Text>

          {/* Animated Interactive Face Display */}
          <Animated.View
            style={[
              styles.faceContainer,
              { transform: [{ scale: pulseAnim }] },
            ]}
          >
            <View style={styles.eyesRow}>
              <Animated.View
                style={[
                  styles.eye,
                  { transform: [{ scaleY: blinkAnim }] },
                  currentEmotion === "ANGRY" && styles.eyeAngry,
                  currentEmotion === "SAD" && styles.eyeSad,
                ]}
              />
              <Animated.View
                style={[
                  styles.eye,
                  { transform: [{ scaleY: blinkAnim }] },
                  currentEmotion === "ANGRY" && styles.eyeAngry,
                  currentEmotion === "SAD" && styles.eyeSad,
                ]}
              />
            </View>
            <View
              style={[
                styles.mouth,
                currentEmotion === "HAPPY" || currentEmotion === "EXCITED"
                  ? styles.mouthHappy
                  : currentEmotion === "SAD"
                  ? styles.mouthSad
                  : styles.mouthNeutral,
              ]}
            />
            <Text style={styles.emotionLabel}>{currentEmotion}</Text>
          </Animated.View>

          {/* Core Navigation Buttons */}
          <View style={styles.menuGrid}>
            <TouchableOpacity style={styles.menuCard} onPress={() => setMode("CHAT")}>
              <Text style={styles.menuIcon}>💬</Text>
              <Text style={styles.menuTitle}>Chat & Voice</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuCard} onPress={() => setMode("ADVANCED")}>
              <Text style={styles.menuIcon}>🎥</Text>
              <Text style={styles.menuTitle}>Advanced Vision Mode</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuCard} onPress={() => setMode("MEMORIES")}>
              <Text style={styles.menuIcon}>🧠</Text>
              <Text style={styles.menuTitle}>Memory Notes</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuCard} onPress={() => setMode("SETTINGS")}>
              <Text style={styles.menuIcon}>⚙️</Text>
              <Text style={styles.menuTitle}>Hardware Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ADVANCED MODE — Camera Vision + Real-Time Command & Control */}
      {mode === "ADVANCED" && (
        <View style={styles.flexContainer}>
          {renderHeader("Advanced Vision & Hardware Control")}
          {!permission?.granted ? (
            <View style={styles.centered}>
              <Text style={styles.darkText}>Camera permission is required.</Text>
              <TouchableOpacity style={styles.actionBtn} onPress={requestPermission}>
                <Text style={styles.actionBtnText}>Grant Camera Permission</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.flexContainer}>
              <CameraView style={styles.cameraPreview} ref={cameraRef}>
                <View style={styles.cameraOverlay}>
                  <Text style={styles.overlayText}>Live Robot Vision Sync</Text>
                </View>
              </CameraView>

              {/* Manual Direct Motor Drive Pad */}
              <View style={styles.drivePadContainer}>
                <Text style={styles.padTitle}>Manual Override Commands</Text>
                <View style={styles.driveRow}>
                  <TouchableOpacity
                    style={styles.driveBtn}
                    onPress={() => syncHardware(currentEmotion, "F")}
                  >
                    <Text style={styles.driveText}>▲ Forward</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.driveRow}>
                  <TouchableOpacity
                    style={styles.driveBtn}
                    onPress={() => syncHardware(currentEmotion, "L")}
                  >
                    <Text style={styles.driveText}>◄ Left</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.driveBtn, styles.stopBtn]}
                    onPress={() => syncHardware(currentEmotion, "S")}
                  >
                    <Text style={styles.driveText}>■ STOP</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.driveBtn}
                    onPress={() => syncHardware(currentEmotion, "R")}
                  >
                    <Text style={styles.driveText}>Right ►</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.driveRow}>
                  <TouchableOpacity
                    style={styles.driveBtn}
                    onPress={() => syncHardware(currentEmotion, "B")}
                  >
                    <Text style={styles.driveText}>▼ Back</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Bottom Interactive Bar */}
              <View style={styles.advInputRow}>
                <TouchableOpacity
                  style={[styles.micBtn, isListening && styles.micActive]}
                  onPress={startSpeechToText}
                >
                  <Text style={styles.micText}>{isListening ? "🎙️..." : "🎙️ Voice"}</Text>
                </TouchableOpacity>

                <TextInput
                  style={styles.advInput}
                  placeholder="Ask Pihu while viewing scene..."
                  placeholderTextColor="#888"
                  value={inputText}
                  onChangeText={setInputText}
                />

                <TouchableOpacity
                  style={styles.snapBtn}
                  onPress={captureAndProcess}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.snapBtnText}>Snap & Ask</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {/* CHAT MODE */}
      {mode === "CHAT" && (
        <View style={styles.flexContainer}>
          {renderHeader("Chat with Pihu")}
          <ScrollView style={styles.chatScroll}>
            {messages.map((m, idx) => (
              <View
                key={idx}
                style={[
                  styles.msgBubble,
                  m.role === "user" ? styles.msgUser : styles.msgModel,
                ]}
              >
                <Text style={styles.msgText}>{m.text}</Text>
              </View>
            ))}
            {loading && <ActivityIndicator size="small" color="#4a90e2" />}
          </ScrollView>

          <View style={styles.advInputRow}>
            <TouchableOpacity style={styles.micBtn} onPress={startSpeechToText}>
              <Text style={styles.micText}>🎙️</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.advInput}
              placeholder="Type message..."
              placeholderTextColor="#888"
              value={inputText}
              onChangeText={setInputText}
            />
            <TouchableOpacity
              style={styles.snapBtn}
              onPress={() => {
                const txt = inputText;
                setInputText("");
                processQuery(txt);
              }}
            >
              <Text style={styles.snapBtnText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* MEMORIES MODE */}
      {mode === "MEMORIES" && (
        <View style={styles.flexContainer}>
          {renderHeader("Robot Memory Notes")}
          <View style={styles.padded}>
            <Text style={styles.darkText}>
              Store personal preferences & memory context for Pihu:
            </Text>
            <TextInput
              style={styles.memoryBox}
              multiline
              value={memoryText}
              onChangeText={setMemoryText}
              placeholder="e.g. My name is Alex, I am building a robot..."
            />
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={async () => {
                await save("pihu_memory", memoryText);
                Alert.alert("Saved", "Memory notes updated successfully.");
              }}
            >
              <Text style={styles.actionBtnText}>Save Memory</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* SETTINGS MODE */}
      {mode === "SETTINGS" && (
        <ScrollView style={styles.flexContainer}>
          {renderHeader("Hardware & API Setup")}
          <View style={styles.padded}>
            <Text style={styles.label}>Gemini API Key:</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="Paste API Key here..."
            />
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={async () => {
                await putKey(apiKey);
                Alert.alert("Success", "Gemini API key saved securely.");
              }}
            >
              <Text style={styles.actionBtnText}>Save API Key</Text>
            </TouchableOpacity>

            <Text style={[styles.label, { marginTop: 20 }]}>ESP8266 TFT IP Address:</Text>
            <TextInput
              style={styles.input}
              value={espIp}
              onChangeText={setEspIp}
              placeholder="192.168.4.1"
            />
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={async () => {
                await save("pihu_esp_ip", espIp);
                Alert.alert("Saved", "ESP8266 IP address saved.");
              }}
            >
              <Text style={styles.actionBtnText}>Save IP</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, { marginTop: 25, backgroundColor: "#2e7d32" }]}
              onPress={async () => {
                const ok = await connectHc05("HC-05");
                setBtConnected(ok);
                Alert.alert(ok ? "Connected" : "Failed", ok ? "HC-05 Connected!" : "HC-05 connection failed.");
              }}
            >
              <Text style={styles.actionBtnText}>Connect HC-05 Bluetooth</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  flexContainer: { flex: 1 },
  homeContainer: { flex: 1, alignItems: "center", padding: 20 },
  title: { fontSize: 24, fontWeight: "bold", color: "#38bdf8", marginTop: 10 },
  statusText: { color: "#94a3b8", fontSize: 12, marginVertical: 8 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 15,
    backgroundColor: "#1e293b",
  },
  headerTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "bold" },
  backBtn: { padding: 5, backgroundColor: "#334155", borderRadius: 5 },
  backBtnText: { color: "#38bdf8", fontWeight: "bold" },
  modelTag: { color: "#4ade80", fontSize: 10, fontWeight: "600" },
  faceContainer: {
    width: 220,
    height: 180,
    backgroundColor: "#0284c7",
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 20,
    borderWidth: 4,
    borderColor: "#38bdf8",
  },
  eyesRow: { flexDirection: "row", justifyContent: "space-around", width: "70%" },
  eye: { width: 35, height: 35, backgroundColor: "#ffffff", borderRadius: 20 },
  eyeAngry: { backgroundColor: "#ef4444", transform: [{ rotate: "15deg" }] },
  eyeSad: { backgroundColor: "#93c5fd" },
  mouth: { width: 60, height: 16, backgroundColor: "#ffffff", borderRadius: 8, marginTop: 25 },
  mouthHappy: { height: 26, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  mouthSad: { height: 16, borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  mouthNeutral: { height: 10 },
  emotionLabel: { color: "#e0f2fe", fontSize: 12, fontWeight: "bold", marginTop: 12 },
  menuGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  menuCard: {
    width: "48%",
    backgroundColor: "#1e293b",
    padding: 16,
    borderRadius: 15,
    alignItems: "center",
    marginBottom: 15,
  },
  menuIcon: { fontSize: 28 },
  menuTitle: { color: "#f8fafc", marginTop: 8, fontSize: 13, fontWeight: "600" },
  cameraPreview: { flex: 1, width: "100%" },
  cameraOverlay: { padding: 10, backgroundColor: "rgba(0,0,0,0.5)" },
  overlayText: { color: "#fff", fontSize: 12, textAlign: "center" },
  drivePadContainer: { backgroundColor: "#1e293b", padding: 12, alignItems: "center" },
  padTitle: { color: "#94a3b8", fontSize: 11, marginBottom: 6 },
  driveRow: { flexDirection: "row", marginVertical: 4 },
  driveBtn: { backgroundColor: "#334155", paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, marginHorizontal: 4 },
  stopBtn: { backgroundColor: "#dc2626" },
  driveText: { color: "#fff", fontWeight: "bold", fontSize: 12 },
  advInputRow: { flexDirection: "row", padding: 10, backgroundColor: "#0f172a", alignItems: "center" },
  advInput: { flex: 1, backgroundColor: "#1e293b", color: "#fff", borderRadius: 8, paddingHorizontal: 12, height: 42, marginHorizontal: 8 },
  micBtn: { backgroundColor: "#0284c7", padding: 10, borderRadius: 8 },
  micActive: { backgroundColor: "#ef4444" },
  micText: { color: "#fff", fontSize: 13, fontWeight: "bold" },
  snapBtn: { backgroundColor: "#16a34a", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  snapBtnText: { color: "#fff", fontWeight: "bold" },
  chatScroll: { flex: 1, padding: 15 },
  msgBubble: { padding: 12, borderRadius: 12, marginBottom: 10, maxWidth: "80%" },
  msgUser: { backgroundColor: "#0284c7", alignSelf: "flex-end" },
  msgModel: { backgroundColor: "#334155", alignSelf: "flex-start" },
  msgText: { color: "#fff", fontSize: 14 },
  padded: { padding: 20 },
  darkText: { color: "#f8fafc", marginBottom: 10 },
  label: { color: "#94a3b8", marginBottom: 5, fontSize: 13 },
  input: { backgroundColor: "#1e293b", color: "#fff", borderRadius: 8, padding: 12, marginBottom: 12 },
  memoryBox: { backgroundColor: "#1e293b", color: "#fff", borderRadius: 8, padding: 12, height: 120, textAlignVertical: "top", marginBottom: 12 },
  actionBtn: { backgroundColor: "#0284c7", padding: 14, borderRadius: 8, alignItems: "center" },
  actionBtnText: { color: "#fff", fontWeight: "bold" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
});
