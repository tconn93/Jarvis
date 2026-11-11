# Surf

Surf is a small Windows app. You name it once. That spoken name is the wake word. After the name, Surf transcribes the phrase, asks whether it is a command for this PC, and either does the command or throws the audio away.

Build 1 controls other Windows programs. Browser control is Build 2 and is not in this tree yet.

## Run

Install Node.js 22 on Windows. From this folder:

```
npm install
npm start
```

Start it with `npm start` under Windows, not from WSL. Unit tests that use fakes can run anywhere Node runs:

```
npm test
```

The API key is entered in the window on first launch. It is encrypted with Windows DPAPI and stored in `%APPDATA%\Surf\secret.bin`. Do not put the key in this repo.

Speech, the command gate, and the tool loop use the xAI API (`grok-voice-transcribe-2.0`, `grok-4.7`, voice `eve`). Desktop actions go through `agent-desktop`.
