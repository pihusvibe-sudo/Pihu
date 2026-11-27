# PIHU AI v1.0 — Android Companion & Hardware Controller

## Included
- Pihu dashboard and animated face
- Gemini chat in Hindi/English/Hinglish with emotion detection (`HAPPY`, `SAD`, `ANGRY`, `EXCITED`, `SHY`, `JEALOUS`, `LONELY`, `CURIOUS`, `CARING`)
- Phone speech recognition input and Android text-to-speech (routes to paired AT110ML Bluetooth audio speaker)
- ESP8266 HTTP emotion & movement sync (`/emotion?state=...&conn=...&move=...`)
- Arduino UNO HC-05 Bluetooth classic drive commands (`F`, `B`, `L`, `R`, `S`)
- Camera preview, capture and Gemini scene description
- Local personal memory notes and named photo profiles

## Hardware Setup Notes
- **AT110ML Bluetooth Audio:** Powered from `5V` and `Common GND`, speaker on `SPK+`/`SPK-`, paired directly to the phone for audio (no Arduino serial wiring needed).
- **Arduino UNO + HC-05 + HC-SR04 + L298N:** Uses `HC-05` for motion commands and `HC-SR04` for obstacle safety; common ground across all modules.
- **ESP8266 + 1.8" TFT:** Connects over Wi-Fi/hotspot and updates face/status via HTTP endpoints (no shared serial wire with UNO).

## Honest limitations in v1.0
- Person profiles store a name and photo only. Automatic biometric face recognition/matching is NOT implemented.
- Always-on Hey Pihu wake word is NOT implemented.
- Camera photos sent for scene description are sent to Gemini. Do not use this feature to identify people.

## Required
1. Gemini API key: https://aistudio.google.com/api-keys
2. GitHub account
3. Expo account: https://expo.dev/signup

## Build APK using phone + GitHub
Upload this project folder to a GitHub repository. Create an Expo account. Open GitHub Codespaces in your phone browser (or another cloud terminal), open the repository folder and run:

```bash
npm install
npm install -g eas-cli
eas login
eas build --platform android --profile preview
