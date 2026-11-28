
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
  getGroqKey,
  putGroqKey,
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

import {
  sendEspEmotion,
  connectHc05,
  sendRobotCommand,
} from "./src/hardware";

type Mode =
  | "HOME"
  | "CHAT"
  | "ADVANCED"
  | "MEMORIES"
  | "PEOPLE"
  | "SETTINGS";

export default function App() {
  const [mode, setMode] = useState<Mode>("HOME");

  // AI provider credentials
  const [apiKey, setApiKey] = useState("");
  const [groqApiKey, setGroqApiKey] = useState("");

  // Hardware state
  const [espIp, setEspIp] = useState("192.168.4.1");
  const [btConnected, setBtConnected] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<Msg[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);

  // AI state
  const [currentEmotion, setCurrentEmotion] =
    useState<EmotionTag>("HAPPY");

  const [activeModel, setActiveModel] = useState("");
  const [memoryText, setMemoryText] = useState("");

  const [people, setPeople] = useState<Person[]>([]);

  // Advanced mode
  const [permission, requestPermission] =
    useCameraPermissions();

  const [isListening, setIsListening] = useState(false);
  const cameraRef = useRef<any>(null);

  // Face animations
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Load saved configuration
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [
          geminiKey,
          groqKey,
          savedIp,
          savedMem,
          savedPeople,
        ] = await Promise.all([
          getKey(),
          getGroqKey(),
          load<string>("pihu_esp_ip", "192.168.4.1"),
          load<string>("pihu_memory", ""),
          load<Person[]>("pihu_people", []),
        ]);

        if (!mounted) return;

        if (geminiKey) setApiKey(geminiKey);
        if (groqKey) setGroqApiKey(groqKey);

        setEspIp(savedIp);
        setMemoryText(savedMem);
        setPeople(savedPeople);
      } catch (error) {
        console.log("Pihu configuration loading failed.");
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Hardware back button
  useEffect(() => {
    const backAction = () => {
      if (mode !== "HOME") {
        setMode("HOME");
        return true;
      }

      return false;
    };

    const handler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => handler.remove();
  }, [mode]);

  // Animated blinking eyes
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

  // Hardware synchronization
  const syncHardware = async (
    emotion: EmotionTag,
    move: RobotAction
  ) => {
    setCurrentEmotion(emotion);

    if (espIp) {
      try {
        await sendEspEmotion(espIp, emotion);
      } catch (error) {
        console.log("ESP8266 sync failed.");
      }
    }

    if (move && move !== "none") {
      try {
        await sendRobotCommand(move);
      } catch (error) {
        console.log("Robot command failed.");
      }
    }
  };

  // Main Pihu AI interaction
  const processQuery = async (
    prompt: string,
    imageBase64?: string
  ) => {
    if (!prompt.trim() && !imageBase64) return;

    if (loading) return;

    // At least one AI provider must be configured
    if (!apiKey.trim() && !groqApiKey.trim()) {
      Alert.alert(
        "AI Key Required",
        "Please configure Gemini or Groq in Settings."
      );

      setMode("SETTINGS");
      return;
    }

    // Gemini is required for camera vision in this implementation
    if (imageBase64 && !apiKey.trim()) {
      Alert.alert(
        "Gemini Required",
        "Camera vision requires a Gemini API key."
      );

      setMode("SETTINGS");
      return;
    }

    const userMsg: Msg = {
      role: "user",
      text: prompt || "[Camera Frame]",
      time: Date.now(),
    };

    const previousMessages = messages;

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setActiveModel("AI racing...");

    try {
      const result = await askGeminiStructured(
        apiKey,
        prompt || "Describe this scene and talk to me as Pihu.",
        previousMessages,
        memoryText,
        imageBase64,
        groqApiKey
      );

      const botMsg: Msg = {
        role: "model",
        text: result.reply,
        time: Date.now(),
      };

      setMessages((prev) => [...prev, botMsg]);

      if (result.modelUsed) {
        setActiveModel(result.modelUsed);
      }

      await syncHardware(
        result.emotion,
        result.move
      );

      Speech.speak(result.reply, {
        language: "hi-IN",
        rate: 0.95,
      });

    } catch (error: any) {
      const errorText =
        error?.message || "Unknown communication error";

      setActiveModel("AI unavailable");

      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          text: `Pihu connection error:\n${errorText}`,
          time: Date.now(),
        },
      ]);

    } finally {
      setLoading(false);
    }
  };

  // Camera capture and vision
  const captureAndProcess = async () => {
    if (!apiKey.trim()) {
      Alert.alert(
        "Gemini Required",
        "Please configure Gemini in Settings for camera vision."
      );
      setMode("SETTINGS");
      return;
    }

    if (!cameraRef.current || loading) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.5,
      });

      if (photo?.base64) {
        await processQuery(
          inputText,
          photo.base64
        );

        setInputText("");
      }
    } catch (error) {
      Alert.alert(
        "Camera Error",
        "Failed to capture camera frame."
      );
    }
  };

  // Voice input
  const startSpeechToText = async () => {
    if (isListening) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (_) {}

      setIsListening(false);
      return;
    }

    try {
      const permissionResult =
        await ExpoSpeechRecognitionModule.requestPermissionAsync();

      if (!permissionResult.granted) {
        Alert.alert(
          "Permission Required",
          "Microphone permission is required."
        );
        return;
      }

      setIsListening(true);

      ExpoSpeechRecognitionModule.start({
        lang: "hi-IN",
        interimResults: false,
        maxAlternatives: 1,
      });

      ExpoSpeechRecognitionModule.addListener(
        "result",
        (event: any) => {
          const spokenText =
            event.results?.[0]?.transcript;

          if (spokenText) {
            setInputText(spokenText);
            processQuery(spokenText);
          }

          setIsListening(false);
        }
      );

    } catch (error) {
      setIsListening(false);

      Alert.alert(
        "Voice Error",
        "Could not start voice recognition."
      );
    }
  };

  // Header
  const renderHeader = (title: string) => (
    <View style={styles.headerRow}>
      {mode !== "HOME" && (
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => setMode("HOME")}
        >
          <Text style={styles.backBtnText}>
            ‹ Back
          </Text>
        </TouchableOpacity>
      )}

      <Text style={styles.headerTitle}>
        {title}
      </Text>

      {activeModel ? (
        <Text
          style={styles.modelTag}
          numberOfLines={1}
        >
          {activeModel}
        </Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>

      {/* HOME MODE */}
      {mode === "HOME" && (
        <View style={styles.homeContainer}>
          <Text style={styles.title}>
            PIHU AI COMPANION
          </Text>

          <Text style={styles.statusText}>
            Status:{" "}
            {btConnected ? "BT Connected" : "BT Disconnected"}
            {" | "}
            IP: {espIp}
          </Text>

          <View style={styles.providerStatus}>
            <Text style={styles.providerText}>
              Gemini: {apiKey ? "Configured" : "Not configured"}
            </Text>

            <Text style={styles.providerText}>
              Groq: {groqApiKey ? "Configured" : "Not configured"}
            </Text>
          </View>

          {/* Animated Face */}
          <Animated.View
            style={[
              styles.faceContainer,
              {
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <View style={styles.eyesRow}>
              <Animated.View
                style={[
                  styles.eye,
                  {
                    transform: [{ scaleY: blinkAnim }],
                  },
                  currentEmotion === "ANGRY" &&
                    styles.eyeAngry,
                  currentEmotion === "SAD" &&
                    styles.eyeSad,
                ]}
              />

              <Animated.View
                style={[
                  styles.eye,
                  {
                    transform: [{ scaleY: blinkAnim }],
                  },
                  currentEmotion === "ANGRY" &&
                    styles.eyeAngry,
                  currentEmotion === "SAD" &&
                    styles.eyeSad,
                ]}
              />
            </View>

            <View
              style={[
                styles.mouth,
                currentEmotion === "HAPPY" ||
                currentEmotion === "EXCITED"
                  ? styles.mouthHappy
                  : currentEmotion === "SAD"
                  ? styles.mouthSad
                  : styles.mouthNeutral,
              ]}
            />

            <Text style={styles.emotionLabel}>
              {currentEmotion}
            </Text>
          </Animated.View>

          {/* Navigation */}
          <View style={styles.menuGrid}>
            <TouchableOpacity
              style={styles.menuCard}
              onPress={() => setMode("CHAT")}
            >
              <Text style={styles.menuIcon}>💬</Text>
              <Text style={styles.menuTitle}>
                Chat & Voice
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuCard}
              onPress={() => setMode("ADVANCED")}
            >
              <Text style={styles.menuIcon}>🎥</Text>
              <Text style={styles.menuTitle}>
                Advanced Vision Mode
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuCard}
              onPress={() => setMode("MEMORIES")}
            >
              <Text style={styles.menuIcon}>🧠</Text>
              <Text style={styles.menuTitle}>
                Memory Notes
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuCard}
              onPress={() => setMode("SETTINGS")}
            >
              <Text style={styles.menuIcon}>⚙️</Text>
              <Text style={styles.menuTitle}>
                Settings
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ADVANCED VISION MODE */}
      {mode === "ADVANCED" && (
        <View style={styles.flexContainer}>
          {renderHeader("Advanced Vision & Hardware Control")}

          {!permission?.granted ? (
            <View style={styles.centered}>
              <Text style={styles.darkText}>
                Camera permission is required.
              </Text>

              <TouchableOpacity
                style={styles.actionBtn}
                onPress={requestPermission}
              >
                <Text style={styles.actionBtnText}>
                  Grant Camera Permission
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.flexContainer}>
              <CameraView
                style={styles.cameraPreview}
                ref={cameraRef}
              >
                <View style={styles.cameraOverlay}>
                  <Text style={styles.overlayText}>
                    Live Robot Vision Sync
                  </Text>
                </View>
              </CameraView>

              {/* Manual Drive Controls */}
              <View style={styles.drivePadContainer}>
                <Text style={styles.padTitle}>
                  Manual Override Commands
                </Text>

                <View style={styles.driveRow}>
                  <TouchableOpacity
                    style={styles.driveBtn}
                    onPress={() =>
                      syncHardware(currentEmotion, "F")
                    }
                  >
                    <Text style={styles.driveText}>
                      ▲ Forward
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.driveRow}>
                  <TouchableOpacity
                    style={styles.driveBtn}
                    onPress={() =>
                      syncHardware(currentEmotion, "L")
                    }
                  >
                    <Text style={styles.driveText}>
                      ◄ Left
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.driveBtn,
                      styles.stopBtn,
                    ]}
                    onPress={() =>
                      syncHardware(currentEmotion, "S")
                    }
                  >
                    <Text style={styles.driveText}>
                      ■ STOP
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.driveBtn}
                    onPress={() =>
                      syncHardware(currentEmotion, "R")
                    }
                  >
                    <Text style={styles.driveText}>
                      Right ►
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.driveRow}>
                  <TouchableOpacity
                    style={styles.driveBtn}
                    onPress={() =>
                      syncHardware(currentEmotion, "B")
                    }
                  >
                    <Text style={styles.driveText}>
                      ▼ Back
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Vision Input */}
              <View style={styles.advInputRow}>
                <TouchableOpacity
                  style={[
                    styles.micBtn,
                    isListening && styles.micActive,
                  ]}
                  onPress={startSpeechToText}
                >
                  <Text style={styles.micText}>
                    {isListening ? "Stop" : "🎙️ Voice"}
                  </Text>
                </TouchableOpacity>

                <TextInput
                  style={styles.advInput}
                  placeholder="Ask Pihu about the scene..."
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
                    <Text style={styles.snapBtnText}>
                      Snap & Ask
                    </Text>
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

          <ScrollView
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
          >
            {messages.map((message, index) => (
              <View
                key={`${message.time}-${index}`}
                style={[
                  styles.msgBubble,
                  message.role === "user"
                    ? styles.msgUser
                    : styles.msgModel,
                ]}
              >
                <Text style={styles.msgText}>
                  {message.text}
                </Text>
              </View>
            ))}

            {loading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator
                  size="small"
                  color="#38bdf8"
                />
                <Text style={styles.loadingText}>
                  Pihu is thinking...
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.advInputRow}>
            <TouchableOpacity
              style={[
                styles.micBtn,
                isListening && styles.micActive,
              ]}
              onPress={startSpeechToText}
            >
              <Text style={styles.micText}>
                {isListening ? "Stop" : "🎙️"}
              </Text>
            </TouchableOpacity>

            <TextInput
              style={styles.advInput}
              placeholder="Type message..."
              placeholderTextColor="#888"
              value={inputText}
              onChangeText={setInputText}
              editable={!loading}
              onSubmitEditing={() => {
                const text = inputText.trim();

                if (text && !loading) {
                  setInputText("");
                  processQuery(text);
                }
              }}
              returnKeyType="send"
            />

            <TouchableOpacity
              style={styles.snapBtn}
              disabled={loading}
              onPress={() => {
                const text = inputText.trim();

                if (text && !loading) {
                  setInputText("");
                  processQuery(text);
                }
              }}
            >
              <Text style={styles.snapBtnText}>
                Send
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* MEMORY MODE */}
      {mode === "MEMORIES" && (
        <View style={styles.flexContainer}>
          {renderHeader("Robot Memory Notes")}

          <View style={styles.padded}>
            <Text style={styles.darkText}>
              Store personal preferences and memory context:
            </Text>

            <TextInput
              style={styles.memoryBox}
              multiline
              value={memoryText}
              onChangeText={setMemoryText}
              placeholder="Add personal memory notes..."
              placeholderTextColor="#888"
            />

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={async () => {
                try {
                  await save("pihu_memory", memoryText);

                  Alert.alert(
                    "Saved",
                    "Memory notes updated successfully."
                  );
                } catch {
                  Alert.alert(
                    "Error",
                    "Could not save memory notes."
                  );
                }
              }}
            >
              <Text style={styles.actionBtnText}>
                Save Memory
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* SETTINGS MODE */}
      {mode === "SETTINGS" && (
        <ScrollView
          style={styles.flexContainer}
          keyboardShouldPersistTaps="handled"
        >
          {renderHeader("AI & Hardware Settings")}

          <View style={styles.padded}>
            <Text style={styles.sectionTitle}>
              AI PROVIDERS
            </Text>

            {/* Gemini Key */}
            <Text style={styles.label}>
              Gemini API Key
            </Text>

            <TextInput
              style={styles.input}
              secureTextEntry
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="Paste Gemini API key..."
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={async () => {
                try {
                  await putKey(apiKey);

                  Alert.alert(
                    "Success",
                    "Gemini API key saved securely."
                  );
                } catch {
                  Alert.alert(
                    "Storage Error",
                    "Could not save Gemini key."
                  );
                }
              }}
            >
              <Text style={styles.actionBtnText}>
                Save Gemini Key
              </Text>
            </TouchableOpacity>

            {/* Groq Key */}
            <Text style={[styles.label, { marginTop: 22 }]}>
              Groq API Key
            </Text>

            <TextInput
              style={styles.input}
              secureTextEntry
              value={groqApiKey}
              onChangeText={setGroqApiKey}
              placeholder="Paste Groq API key..."
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={async () => {
                try {
                  await putGroqKey(groqApiKey);

                  Alert.alert(
                    "Success",
                    "Groq API key saved securely."
                  );
                } catch {
                  Alert.alert(
                    "Storage Error",
                    "Could not save Groq key."
                  );
                }
              }}
            >
              <Text style={styles.actionBtnText}>
                Save Groq Key
              </Text>
            </TouchableOpacity>

            {/* Provider Status */}
            <View style={styles.providerBox}>
              <Text style={styles.providerTitle}>
                Provider Configuration
              </Text>

              <Text style={styles.providerText}>
                Gemini: {apiKey ? "Configured" : "Missing"}
              </Text>

              <Text style={styles.providerText}>
                Groq: {groqApiKey ? "Configured" : "Missing"}
              </Text>

              <Text style={styles.providerHint}>
                Both configured providers participate in
                parallel requests for text chat.
              </Text>
            </View>

            <View style={styles.separator} />

            {/* Hardware Settings */}
            <Text style={styles.sectionTitle}>
              HARDWARE SETTINGS
            </Text>

            <Text style={styles.label}>
              ESP8266 TFT IP Address
            </Text>

            <TextInput
              style={styles.input}
              value={espIp}
              onChangeText={setEspIp}
              placeholder="192.168.4.1"
              placeholderTextColor="#888"
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={async () => {
                try {
                  await save("pihu_esp_ip", espIp);

                  Alert.alert(
                    "Saved",
                    "ESP8266 IP address saved."
                  );
                } catch {
                  Alert.alert(
                    "Error",
                    "Could not save IP address."
                  );
                }
              }}
            >
              <Text style={styles.actionBtnText}>
                Save IP
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionBtn,
                {
                  marginTop: 25,
                  backgroundColor: "#2e7d32",
                },
              ]}
              onPress={async () => {
                try {
                  const ok = await connectHc05("HC-05");

                  setBtConnected(ok);

                  Alert.alert(
                    ok ? "Connected" : "Failed",
                    ok
                      ? "HC-05 Connected!"
                      : "HC-05 connection failed."
                  );
                } catch {
                  setBtConnected(false);

                  Alert.alert(
                    "Bluetooth Error",
                    "Could not connect to HC-05."
                  );
                }
              }}
            >
              <Text style={styles.actionBtnText}>
                Connect HC-05 Bluetooth
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// STYLES
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },

  flexContainer: {
    flex: 1,
  },

  homeContainer: {
    flex: 1,
    alignItems: "center",
    padding: 20,
  },

  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#38bdf8",
    marginTop: 10,
  },

  statusText: {
    color: "#94a3b8",
    fontSize: 12,
    marginVertical: 8,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 15,
    backgroundColor: "#1e293b",
  },

  headerTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "bold",
    flexShrink: 1,
  },

  backBtn: {
    padding: 5,
    backgroundColor: "#334155",
    borderRadius: 5,
  },

  backBtnText: {
    color: "#38bdf8",
    fontWeight: "bold",
  },

  modelTag: {
    color: "#4ade80",
    fontSize: 10,
    fontWeight: "600",
    maxWidth: 120,
  },

  providerStatus: {
    width: "100%",
    backgroundColor: "#1e293b",
    padding: 10,
    borderRadius: 10,
    marginTop: 5,
  },

  providerBox: {
    backgroundColor: "#1e293b",
    padding: 14,
    borderRadius: 10,
    marginTop: 18,
  },

  providerTitle: {
    color: "#38bdf8",
    fontWeight: "bold",
    marginBottom: 8,
  },

  providerText: {
    color: "#cbd5e1",
    fontSize: 12,
    marginVertical: 2,
  },

  providerHint: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 8,
    lineHeight: 16,
  },

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

  eyesRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "70%",
  },

  eye: {
    width: 35,
    height: 35,
    backgroundColor: "#ffffff",
    borderRadius: 20,
  },

  eyeAngry: {
    backgroundColor: "#ef4444",
    transform: [{ rotate: "15deg" }],
  },

  eyeSad: {
    backgroundColor: "#93c5fd",
  },

  mouth: {
    width: 60,
    height: 16,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    marginTop: 25,
  },

  mouthHappy: {
    height: 26,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },

  mouthSad: {
    height: 16,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
  },

  mouthNeutral: {
    height: 10,
  },

  emotionLabel: {
    color: "#e0f2fe",
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 12,
  },

  menuGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  menuCard: {
    width: "48%",
    backgroundColor: "#1e293b",
    padding: 16,
    borderRadius: 15,
    alignItems: "center",
    marginBottom: 15,
  },

  menuIcon: {
    fontSize: 28,
  },

  menuTitle: {
    color: "#f8fafc",
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
  },

  cameraPreview: {
    flex: 1,
    width: "100%",
  },

  cameraOverlay: {
    padding: 10,
    backgroundColor: "rgba(0,0,0,0.5)",
  },

  overlayText: {
    color: "#fff",
    fontSize: 12,
    textAlign: "center",
  },

  drivePadContainer: {
    backgroundColor: "#1e293b",
    padding: 12,
    alignItems: "center",
  },

  padTitle: {
    color: "#94a3b8",
    fontSize: 11,
    marginBottom: 6,
  },

  driveRow: {
    flexDirection: "row",
    marginVertical: 4,
  },

  driveBtn: {
    backgroundColor: "#334155",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginHorizontal: 4,
  },

  stopBtn: {
    backgroundColor: "#dc2626",
  },

  driveText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 12,
  },

  advInputRow: {
    flexDirection: "row",
    padding: 10,
    backgroundColor: "#0f172a",
    alignItems: "center",
  },

  advInput: {
    flex: 1,
    backgroundColor: "#1e293b",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
    marginHorizontal: 8,
  },

  micBtn: {
    backgroundColor: "#0284c7",
    padding: 10,
    borderRadius: 8,
  },

  micActive: {
    backgroundColor: "#ef4444",
  },

  micText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "bold",
  },

  snapBtn: {
    backgroundColor: "#16a34a",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },

  snapBtnText: {
    color: "#fff",
    fontWeight: "bold",
  },

  chatScroll: {
    flex: 1,
    padding: 15,
  },

  chatContent: {
    paddingBottom: 15,
  },

  msgBubble: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    maxWidth: "85%",
  },

  msgUser: {
    backgroundColor: "#0284c7",
    alignSelf: "flex-end",
  },

  msgModel: {
    backgroundColor: "#334155",
    alignSelf: "flex-start",
  },

  msgText: {
    color: "#fff",
    fontSize: 14,
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },

  loadingText: {
    color: "#94a3b8",
    fontSize: 12,
  },

  padded: {
    padding: 20,
  },

  darkText: {
    color: "#f8fafc",
    marginBottom: 10,
  },

  label: {
    color: "#94a3b8",
    marginBottom: 5,
    fontSize: 13,
  },

  sectionTitle: {
    color: "#38bdf8",
    fontSize: 13,
    fontWeight: "bold",
    marginBottom: 15,
  },

  input: {
    backgroundColor: "#1e293b",
    color: "#fff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },

  memoryBox: {
    backgroundColor: "#1e293b",
    color: "#fff",
    borderRadius: 8,
    padding: 12,
    height: 120,
    textAlignVertical: "top",
    marginBottom: 12,
  },

  separator: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 25,
  },

  actionBtn: {
    backgroundColor: "#0284c7",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },

  actionBtnText: {
    color: "#fff",
    fontWeight: "bold",
  },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
