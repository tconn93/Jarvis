# Surf

Surf is a small desktop app for Windows and Linux. You name it once. That spoken name is the wake word. After the name, Surf transcribes the phrase, asks whether it is a command for this computer, and either does the command or throws the audio away.

It controls other programs through the accessibility tree. A Chrome or Edge extension, in `extension/`, does the browser work. Load that folder unpacked and pair it from the expanded window.

## Run

Install Node.js 22. From this folder:

```
npm install
npm start
```

On Windows, run that in Windows itself, not inside WSL, so the microphone and other programs are the ones on your desktop.

On Linux, Surf needs a session with a display, an accessibility service (AT-SPI), and a keyring (GNOME Keyring or KDE Wallet) so the API key can be encrypted. `unzip` or `python3` is used once to unpack the speech model. Surf starts the desktop helper that matches the computer it is running on, so one install covers Windows and Linux. `npm install` should be allowed to run install scripts so that helper is linked.

Unit tests use fakes and do not need a microphone:

```
npm test
```

The API key is entered in the window on first launch. It is encrypted with the operating system (Windows DPAPI, or the Linux secret service) and stored as `secret.bin` under the app data folder: `%APPDATA%\Surf` on Windows, `~/.config/Surf` on Linux. Do not put the key in this repo.

Speech, the command gate, and the tool loop use the xAI API (`grok-voice-transcribe-2.0`, `grok-4.7`, voice `eve`).

## Browser

1. Start Surf.
2. Expand the window and choose Pair browser. A code appears.
3. In Chrome or Edge, load `extension/` as an unpacked extension.
4. Open the extension popup, paste the code, and pair.
5. Disconnect browser in the window revokes the token.
