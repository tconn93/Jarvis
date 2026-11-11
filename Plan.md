# Surf plan

Date: 2026-11-11

This is the build order for the design in `Design.md`. Build 1 is an Electron app that listens for the agent's name and controls Windows programs. Build 2 adds browser control through an extension and a local WebSocket.

Do not start Build 2 until the Build 1 success checks pass.

Run Surf with Windows Node.js 22 and `npm start`. Unit tests that use fakes can run in WSL. Anything that opens Notepad, reads the microphone, or loads the extension runs on Windows.

API details and the tool list are in `Design.md`. Implementation reads these pages again before the first client call, and copies the request shape from them:

- https://docs.x.ai/developers/quickstart
- https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
- https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
- https://docs.x.ai/developers/tools/function-calling
- https://docs.x.ai/developers/model-capabilities/text/structured-outputs
- https://www.npmjs.com/package/agent-desktop

Models named in the design: `grok-voice-transcribe-2.0` for transcription, `grok-4.7` for the gate and the tool loop, TTS voice `eve` by default.

## Build 1 — desktop agent

### 1. Project skeleton

Create `package.json` with `"type": "module"` and a `start` script of `electron .`. Dependencies: `electron`, `openai`, `vosk`, `@picovoice/pvrecorder-node`, `agent-desktop`. Dev dependency: nothing beyond Node's built-in test runner.

Create `src/`, `renderer/`, and `test/` as in the layout in `Design.md`. `README.md` says to install Node.js 22 on Windows, run `npm install`, then `npm start`. The API key is entered in the window and is not put in a file in this repo.

In this step, load `vosk` and `@picovoice/pvrecorder-node` from the Electron main process. If both import cleanly, keep audio in the main process. If either throws an ABI error, add a helper started with system `node` and a JSON-line pipe, and leave the window in Electron. Record which path won in a short comment at the top of `src/audio.js`.

Check: `npm start` opens the compact window on Windows. `npm test` exits 0 with no tests failing.

### 2. Settings and first run

`src/settings.js` reads and writes `%APPDATA%\Surf\settings.json` with the agent name, voice id, window position, and whether the panel is expanded. The name must be 2 to 32 characters, using letters, numbers, spaces, and apostrophes.

The API key is encrypted with `safeStorage.encryptString` and written to `%APPDATA%\Surf\secret.bin`. `settings.json` does not contain the key.

On launch, if either value is missing, the window shows the name field and the key field. After a valid save it shrinks to the compact bar. If both exist, skip the form.

Check: a unit test rejects a one-character name and a name with punctuation other than an apostrophe. A test double for `safeStorage` writes the ciphertext outside the project directory.

### 3. The window

`renderer/index.html`, `renderer/app.js`, and `renderer/styles.css` draw the compact bar and the expanded panel from `Design.md`.

`src/preload.js` exposes only: `getState`, `onState`, `submitSetup`, `setMuted`, `setExpanded`, `stop`, `confirm`, `rename`, and `quit`. The renderer has no Node integration.

The compact bar is about 320 by 72. The mic button calls `setMuted`. The chevron calls `setExpanded`. Expanded size is about 320 by 440 and shows "Now" and "Log". The header is the drag region.

The main process creates a frameless, resizable-off `BrowserWindow`. Closing it hides the window. A tray icon remains, with Show, Mute or Unmute, and Quit. The tray icon uses a muted mark when capture is off.

Check: a renderer test is not required. By hand, mute, unmute, expand, collapse, hide, and show from the tray. Position survives a restart.

### 4. Microphone, clips, and playback

`src/audio.js` captures 16 kHz mono 16-bit PCM from the default input device and writes a WAV under `%TEMP%\Surf\utterances\`.

`setMuted(true)` stops the recorder before the next frame is kept. `setMuted(false)` starts it again.

After the wake word, recording stops at about 700 ms of trailing silence or at 15 seconds. Silence means the frame energy stays under the threshold in `Design.md`. `deleteClip` removes one file. `deleteAllClips` runs on quit.

Playback writes a WAV and asks the renderer to play it. The renderer sends `ended`. The caller treats the span from the play request through `ended`, plus 300 ms, as time when wake detection is paused.

If no input device is available, report an error state. Do not quit.

Check: a test writes a clip into a temp directory and asserts both delete functions remove it. Mute is covered by a fake recorder that counts `start` and `stop`. Device tests are manual.

### 5. Wake word

`src/wake.js` loads the small English Vosk model from `%APPDATA%\Surf\models\vosk`. If the model is absent, download the official small English archive once.

The recognizer grammar is the agent name plus an unknown sink. Changing the name in settings rebuilds the grammar without a restart.

The detector yields "wake" only when the name is recognized. Feeding it silence or other words yields nothing.

Check: a unit test builds the grammar list from "Nova" and from "Blue Sky" and asserts the name string is the only phrase in the grammar. A Windows manual check says the name and confirms the recorder starts.

### 6. Speech to text

`src/stt.js` posts the WAV to `https://api.x.ai/v1/stt` with `model=grok-voice-transcribe-2.0`, `format=true`, `language=en`, and the file last. It returns the `text` field.

On a network error or a 5xx response, retry once. Then throw. The caller deletes the clip.

Check: a fake HTTP server asserts field order and returns a fixed transcript. The client surfaces that transcript. A dropped connection is tried twice.

### 7. Command gate

`src/gate.js` sends the transcript to `grok-4.7` with a JSON schema `{ "is_command": boolean, "reply": string }`.

The prompt says yes only for an instruction to do something on this computer, and no for conversation, background speech, and a bare name. Ambiguous phrases are no.

A schema failure, a timeout, or a parse error returns no. `reply` is ignored when `is_command` is false. A no result does not call the logger.

Check: tests with a fake client cover a yes object, a no object, malformed JSON, and a timeout. All failures become no. No test calls the network.

### 8. Activity log

`src/log.js` appends `{ at, kind, text }` lines. Kinds are `heard`, `step`, `said`, and `error`. It keeps the newest 200 lines in memory and in `%APPDATA%\Surf\activity.log`. The renderer receives the list on each change.

Check: adding 201 lines leaves 200, and the oldest is gone. A gate result of no does not call `log.append`.

### 9. Desktop tools

`src/tools/desktop.js` spawns `agent-desktop` and accepts only the commands named in `Design.md`.

Rules to enforce in the tool functions, before any process starts:

- `launch_app` accepts a display name only. A value that looks like a path is an error.
- `press_keys` rejects Win+R, Win+X, and Alt+F4.
- `invoke_control` rejects risky names (delete, remove, send, pay, purchase, buy, checkout, place order) unless the caller passes `confirmed: true`.
- `close_window` always returns "confirmation required" unless `confirmed` is true.
- `inspect_window` caps depth and node count and returns a short tree.
- Typed text goes on stdin with `--stdin`.

Each function returns a plain object. Failures are `{ ok: false, error }`. They do not throw out of the tool boundary.

Every accepted call appends a `step` log line and a row in the "Now" list.

Check: unit tests cover the rejections above and assert `agent-desktop` was not spawned. A Windows-only test, skipped when `process.platform !== "win32"`, launches Notepad, types a sentence with `set_text`, and reads it back.

### 10. Tool loop

`src/agent.js` calls `grok-4.7` with the desktop tool definitions. It sends the transcript and the foreground window title.

For each function call it dispatches to `desktop.js` and returns a `function_call_output`. Parallel calls in one response all run before the next request.

The loop stops when the model sends a normal message, when `finish` is called, or after 8 rounds. The user-facing line is the `finish` text or the final message, trimmed to two sentences.

Unknown tool names go back to the model as an error result.

Check: a fake model that always requests another tool stops at 8 rounds and returns a spoken failure line. A fake model that calls `finish` on round 1 returns that sentence and makes no further request.

### 11. Confirmation

`src/confirm.js` speaks the question through the TTS client, then listens for 15 seconds without the wake word. "Yes" returns true. "No", any other words, or silence returns false.

The expanded panel shows Yes and No for the same wait. The first answer, spoken or clicked, wins.

While this listen is active, the wake path is paused. On false, the agent loop ends and the spoken line is "Cancelled."

`close_window` and a risky `invoke_control` call this before they act. One yes covers that single action, not later actions in the same command.

Check: a fake clock and a fake transcript feed cover yes, no, an unrelated phrase, a button yes, and a 15 second timeout.

### 12. Spoken replies

`src/speech.js` posts to `https://api.x.ai/v1/tts` with the voice id from settings, `language` `en`, and WAV output. It plays the bytes through the renderer.

Call it only after the gate has said yes: success, unrecoverable failure, abort, or cancellation. Do not call it when the gate says no or when speech-to-text never returned.

If TTS fails, leave the line on the status and in the log, and resume listening.

Check: a fake TTS server returns a tiny WAV and the player test double records that playback started. A 500 response is retried once and then reported without quitting the app.

### 13. Main loop

`src/main.js` owns the states from the design: needs setup, listening, hearing, deciding, working, speaking, waiting for yes, muted, offline, error.

The loop is:

1. Listen locally for the name, unless muted.
2. Record the rest of the phrase.
3. Transcribe.
4. Run the gate.
5. On no, delete the clip and go back to listening. Do not log.
6. On yes, log "heard", run the agent, speak the line, log "said", delete the clip, and go back to listening.

While working, ignore new audio except the name plus "stop" or "cancel". The Stop button sends the same abort. Surf speaks that it stopped.

Pause wake detection during playback and for 300 ms afterward.

One command at a time. A network failure before the gate sets the status to offline, deletes the clip, logs an error, and keeps listening.

Check: a fake pipeline test walks one yes transcript and one no transcript. The no path does not call the agent, TTS, or the logger. The yes path calls all three and deletes the clip. A muted recorder produces no wake event.

### 14. Build 1 done when

Run these on Windows, by hand, with a real key:

- Set the name to Nova. The compact window reads Listening.
- Mute the mic, say "Nova, open Notepad", then unmute. Notepad did not open during mute.
- Say "Nova, open Notepad". Notepad opens. Surf speaks a short confirmation. Expand the window and see the heard, step, and said lines. The WAV is gone from `%TEMP%\Surf\utterances\`.
- Say "Nova, type hello in Notepad". The focused Notepad document contains hello.
- Say a full sentence that is not a command. Surf stays quiet, leaves no WAV, and adds no log line.
- Say "Nova, close Notepad". Surf asks. Say "no". Notepad stays open and Surf says "Cancelled."
- Say "Nova, close Notepad" again. Click No, or say "no". Then repeat and click Yes. Notepad closes only after Yes.
- Start a command and say "Nova, stop". The command aborts. Mute, start a command another way if one is still running, and click Stop.

Unit tests from steps 2 through 13 pass without a microphone and without a network connection.

## Build 2 — browser extension

Start this only after Build 1 is done. The voice path, gate, confirmation, and window stay as they are. Browser tools join the same tool loop.

### 15. Local bridge

`src/bridge/server.js` binds `127.0.0.1` only, starting at port `47321` and trying through `47330`. Use the `ws` package.

It serves:

- `GET /health` returns the port and the word `ok`. It does not return the token.
- `POST /pair` accepts a one-time code created by "Pair browser" and returns a long-lived token.
- The WebSocket path `/ws` requires a first frame `{ "type": "auth", "token": "<token>" }`. A bad token closes the socket.

"Disconnect browser" revokes the token. Pairing is a control in the expanded window.

Call frames and result frames use the JSON shapes in `Design.md`. A call without a matching result within 20 seconds fails that tool call.

Check: `test/bridge-protocol.test.js` connects to a test port, fails auth with a wrong token, passes auth with a paired token, and round-trips one call. A test asserts the server socket is `127.0.0.1`.

### 16. Extension shell

Create `extension/` as a Manifest V3 extension for Chrome and Edge.

- `manifest.json` requests permissions for tabs, scripting, clipboard, and host access to `http://127.0.0.1/*`.
- `popup.html` has a field for the pairing code and a connected or disconnected label.
- `background.js` stores the token in `chrome.storage.local`, opens the WebSocket, answers `call` messages, and sends `result` messages.
- `content.js` runs in the page and performs the DOM actions the background script asks for.

Load the folder as an unpacked extension. Pair it from the expanded window. The popup shows connected.

Check: with Surf running, the popup pairs. The WebSocket stays up across a tab change.

### 17. Page tools

Implement the browser tools from `Design.md` inside the content script, dispatched by `background.js`.

`src/tools/browser.js` exposes those tools to the agent. Each one sends a bridge call and waits for the result. If the extension is disconnected, the tool returns `{ ok: false }` with an error the model can say aloud. The desktop tools still work.

Search is navigation to the engine's query URL. Google uses `https://www.google.com/search?q=` and an encoded query. If a search needs a place and the transcript has none, the tool is not called. The spoken reply says the place was missing.

`browser_choose_file` and any control that spends money, sends a message, or changes an account go through `confirm.js` first.

Login and MFA are click and type only. There is no password store. An MFA prompt ends the tool with a spoken "waiting for you" line.

Cookie dismissal uses the saved choice. The default is reject.

Each browser step appears in "Now" and in the log, the same way desktop steps do.

Check: a local HTML fixture page, opened in the paired browser, supports click, type, find, scroll, extract, a form fill, and a collapsible section. A checkout button on that page does nothing until the fake confirmer returns yes.

### 18. Register the tools

Add the browser tools to the agent's tool list when the bridge has an authenticated socket. Leave them out otherwise, so the model does not call them while the extension is down.

The round limit stays 8. Confirmation rules from Build 1 apply to the risky browser actions.

Check: the fake-model loop from step 10 gains one browser tool and still stops at 8 rounds. A disconnected socket produces a spoken failure and no desktop side effect.

### 19. Build 2 done when

On Windows, with the extension paired:

- Say "Nova, google 5 star restaurants in town". A new tab opens on a Google results URL whose query is those words. Surf does not add a city. The expanded log shows the step.
- Say "Nova, find parking on this page" on a page that contains the word. The page highlights it.
- Say "Nova, click" and a real button name. The button activates.
- Say a checkout or send command. Surf asks first. "No" leaves the page unchanged.
- Disconnect the browser from the expanded window. The next browser command speaks that the browser is not connected. Desktop commands still work.

## Later, not in these two builds

- Firefox.
- Vision-based clicking for apps that expose no accessibility tree.
- Spoken replies for phrases that are not commands.
