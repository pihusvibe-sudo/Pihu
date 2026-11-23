# PIHU AI v1.0 — Phone-only Android prototype

## Included
- Pihu dashboard and animated face
- Gemini chat in Hindi/English/Hinglish
- Phone speech recognition input and Android text-to-speech
- Camera preview, capture and Gemini scene description
- Local personal memory notes and named photo profiles
- Virtual movement controls (simulation only)

## Honest limitations in v1.0
- Person profiles store a name and photo only. Automatic biometric face recognition/matching is NOT implemented.
- Always-on Hey Pihu wake word is NOT implemented.
- Physical ESP32/Arduino control, background assistant and calendar integration are NOT implemented.
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
```

The `preview` profile in `eas.json` produces an installable APK. Download it from the Expo build page and install it on your Android phone. Expo's official APK instructions: https://docs.expo.dev/build-reference/apk/

Speech recognition uses a native module, so Expo Go is not enough; use the EAS-built APK.

## Configure Gemini
Open Pihu → Settings → paste your Gemini API key → Save API key.
Model is set to `gemini-2.5-flash` in `src/gemini.ts`. If unavailable for your account, change it to a model shown in your Google AI Studio.

## API key safety
The key is stored using Android SecureStore but a client-side mobile app key is not fully secret. This is suitable only for private testing. Never commit the key to GitHub. Before public release, move Gemini calls behind a protected backend.

## Data
Chat, memory and people profile metadata are stored locally on the phone. Avoid storing passwords or sensitive personal details.
