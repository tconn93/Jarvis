# Surf design

Date: 2026-11-11

Surf is a small Windows app built with Electron and Node.js. You name the agent once. That spoken name is the wake word. After the name, Surf transcribes the rest of the phrase, asks a model whether it is a command for this PC, and either does the command or throws the audio away.

The window stays compact. A mic button mutes and unmutes capture. Expanding the window shows the task Surf is doing and a text log of recent commands. The first build controls other Windows programs through the accessibility tree. Browser control is the following build. A Chrome and Edge extension talks to Surf over a WebSocket bound to this computer only.

## Decisions

- The app is Electron on Node.js 22, written in JavaScript. It runs on Windows from this folder. You start it with `npm start` under Windows, not from WSL. Unit tests that use fakes can run anywhere Node runs.
- The agent name is chosen in the window on first launch. The wake word is that name alone. "Nova" wakes an agent named Nova. The app does not add "Hey" in front of it.
- Audio stays on the PC until the wake word is recognized. Recognition uses the official `vosk` package with a grammar set to the name. First-run setup validates that the chosen name exists in the Vosk phonetic dictionary. Renaming rebuilds that grammar. There is no separate wake-word training step.
- The microphone is read in the main process with `@picovoice/pvrecorder-node` at 16 kHz, mono, 16-bit PCM. The mute button stops that recorder. Hiding the window does not stop listening.
- Speech-to-text, the command decision, the tool loop, and spoken replies use the xAI API via native Node `fetch()`. The base URL is `https://api.x.ai/v1`. The key is encrypted with Electron `safeStorage` (Windows DPAPI) and stored in `%APPDATA%\Surf\secret.bin`. It is never written in the project folder or in the log.
- Desktop actions go through the `agent-desktop` command, which reads Windows UI Automation. Surf wraps a short allowlist around it. Surf does not call its screenshot, shell, or raw mouse commands. `agent-desktop` runs as a continuous background process during a command loop to eliminate per-action spawn latency.
- A command is carried out with that allowlist. Surf does not open a shell, the Run dialog, or a program from a raw file path.
- Surf speaks the outcome of a real command. If the phrase is not a command, Surf deletes the recording, writes nothing in the log, and stays quiet.
- Close, delete, send, and pay wait for a spoken yes. Other clicks and typing run immediately.
- One command runs at a time.
- The expanded window shows the live task and a text log. The log keeps the last 200 lines in `%APPDATA%\Surf\activity.log`. Lines record the time, the kind of event, and a short sentence. Kinds are heard, step, said, and error. Audio files are still deleted. Phrases that are not commands are not logged.
- Browser control is not part of the first build. When it is built, a Chromium extension performs the page actions. Surf and the extension communicate with a WebSocket on `127.0.0.1`.

## The window

The window is a small frameless panel, about 320 by 72 pixels when collapsed. You drag it from the header. The header has `-webkit-app-region: drag`, while the interactive buttons explicitly use `-webkit-app-region: no-drag` so clicks register. The header shows the agent name, a mic button, a one-line status, and a chevron.

Mic button:

- On: the recorder is running and the status can read Listening.
- Off: the recorder is stopped immediately. No frames are captured and no audio is written. The status reads Muted. Clicking again resumes listening.

Chevron:

- Collapsed is the bar above.
- Expanded grows the window to about 320 by 440 pixels. The header stays. Below it, "Now" lists the steps of the command in progress. "Log" lists recent lines, oldest at the top.
- Expanding and collapsing remembers which size you left it in.

Status line, in order of what you should see: needs setup, listening, hearing, deciding, working, speaking, waiting for yes, muted, offline, error.

Closing the window hides it. The app keeps running, and a tray icon remains. The tray icon shows a muted mark when the mic is off. The tray menu has Show, Mute or Unmute, and Quit. Quit deletes leftover recordings.

First launch uses this same window, taller, with two fields: the agent name and the API key. The name is 2 to 32 characters, validated against the Vosk dictionary to ensure it can be recognized. After a valid save, the window shrinks to the compact bar and listening starts. The name and the TTS voice id live in `%APPDATA%\Surf\settings.json`. The default voice is `eve`. Rename and voice sit in the expanded panel.

The window position is saved in settings and restored on the next launch.

## Voice path

```
microphone
  -> local wake-word grammar (agent name only)
  -> record until VAD silence
  -> xAI speech-to-text
  -> yes/no command gate
       no  -> delete audio, stay quiet, write no log line
       yes -> tool loop on the PC -> speak the result -> delete audio -> log the line
```

The local model is the small English Vosk model, downloaded once to `%APPDATA%\Surf\models\vosk`. Its grammar contains the agent name and an unknown-token sink, so ordinary speech does not count as a wake. The name itself is not uploaded.

`vosk` and `pvrecorder` ship native binaries for Node. Electron's Node ABI is sometimes different. On startup Surf tries to load both inside the Electron main process. If either load fails, Surf starts a helper with the system `node` binary and talks to it over stdin and stdout, one JSON line per message. The window and the tool loop stay in Electron. The helper only captures audio and reports wake and utterance events.

When the name is heard, Surf records the following speech using a real Voice Activity Detector (VAD). Surf allows up to 2.5 seconds of silence for the user to start their command. Once speech starts, recording stops after 700 ms of trailing silence, or until 15 seconds, whichever comes first. If you only say the name, Surf deletes the clip and stays quiet.

The command clip is a WAV file under `%TEMP%\Surf\utterances\`. It is deleted when the gate says no, when the command finishes, when a send fails past its retry, and when Surf exits.

While Surf is speaking, wake detection is paused, plus 300 ms after playback ends, so the speakers do not wake it. Playback is a WAV played by a hidden audio element in the renderer. The main process tells the renderer when to start, and the renderer tells the main process when it ends.

While a command is running, a new phrase is ignored. The exception is the wake name followed by "stop" or "cancel", which aborts the command. Surf then says that it stopped, and the log records it.

Mute during a command stops new capture. The command already running is allowed to finish. "Stop" is unavailable while muted, so the expanded panel also has a Stop button that aborts the current command.

## APIs

Docs used for this design:

- Models: https://docs.x.ai/developers/models
- Speech to text: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
- Text to speech: https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
- Function calling: https://docs.x.ai/developers/tools/function-calling
- Structured outputs: https://docs.x.ai/developers/model-capabilities/text/structured-outputs
- Quickstart: https://docs.x.ai/developers/quickstart
- Desktop control: https://www.npmjs.com/package/agent-desktop

Calls, copied from those pages:

- Speech to text: `POST https://api.x.ai/v1/stt` as multipart form data. Model `grok-voice-transcribe-2.0`. Fields `format=true` and `language=en` come before the `file` field. Surf reads the `text` field from the JSON response.
- Command gate and tool loop: direct `fetch` to `POST https://api.x.ai/v1/responses`, model `grok-4.7`.
- The gate uses structured output (`response_format` JSON schema). The object is `{ "is_command": boolean, "reply": string }`. `reply` is empty when `is_command` is false.
- Tools are function definitions on that same Responses request. Surf executes each function locally and sends the result back as a `function_call_output`.
- Speech: `POST https://api.x.ai/v1/tts` with `voice_id` (default `eve`), `language` `en`, and WAV output. The renderer plays those bytes.

The client reads the key through `safeStorage` at startup.

## Command gate

The gate sees only the transcript. It answers yes when the words are an instruction to do something on this computer. It answers no for conversation, background speech, questions aimed at a person, and a bare wake name.

The instruction to the model is conservative: when the phrase is ambiguous, `is_command` is false. A schema failure, a timeout, or an unclear parse is treated as no. The clip is deleted and Surf stays quiet.

A yes writes a "heard" log line with the transcript. Each tool call appends a "step" line. The spoken sentence is a "said" line.

## Doing a command

On a yes, Surf starts a tool loop with `grok-4.7`. The first input is the transcript plus the foreground window title. The model calls tools, Surf runs them, and the results go back to the model.

The loop ends when the model returns a normal message, when it calls `finish`, or after 8 model rounds. The spoken reply is one or two sentences. The same text is the status line and a log line. The "Now" list shows each step while the round is running, then keeps those steps until the next command replaces them.

If a tool fails, the error string goes back to the model so it can try another control. If the round limit hits first, Surf says that it stopped before finishing.

### Desktop tools

`src/tools/desktop.js` launches a long-lived `agent-desktop` child process per active command loop (using `--stdin`). This avoids the high latency of spawning the process on every single 8-round call. It maps Surf's tools onto these commands only: `list-windows`, `launch`, `focus-window`, `snapshot`, `find`, `click`, `set-value`, `type`, `press`, `get`, and the close command for a window. It does not spawn `screenshot`, `batch`, `mouse-click`, `open-system-surface`, or a shell.

| Tool             | What it does                                                                                                                   |
|------------------|--------------------------------------------------------------------------------------------------------------------------------|
| `list_windows`   | Returns titles and process names of visible top-level windows.                                                                 |
| `launch_app`     | Starts an installed app by its Start menu display name.                                                                        |
| `focus_window`   | Brings a window to the foreground by title or process name.                                                                    |
| `inspect_window` | Returns a shortened accessibility snapshot: name, role, enabled state. Depth and node count are capped to prevent COM freezes. |
| `invoke_control` | Finds a control by accessible name and clicks it.                                                                              |
| `set_text`       | Sets the value of a named field, or types into the focused editable control.                                                   |
| `press_keys`     | Sends an allowlisted shortcut.                                                                                                 |
| `read_text`      | Reads the text of a named control when the app exposes it.                                                                     |
| `close_window`   | Closes a window. Always requires confirmation.                                                                                 |
| `finish`         | Ends the loop with the sentence Surf will speak.                                                                               |

`launch_app` accepts a display name only. A path such as `C:\something.exe` is rejected before `agent-desktop` is queried.

`press_keys` rejects chords that open a shell or the Run dialog, including Win+R and Win+X. Alt+F4 is rejected. Closing goes through `close_window`.

`invoke_control` rejects a control whose name is a risky verb (delete, remove, send, pay, purchase, buy, checkout, place order) unless this command already has a spoken yes for that action.

Text sent to `set-value` and `type` is passed to the child via `stdin` JSON envelopes so the typed text is not exposed in Windows process arguments.

### Confirmation

Risky actions are closing a window, deleting, sending, and paying. Surf speaks a short question, for example "Close Notepad?" The status reads "waiting for yes", and the question is a log line.

For the next 15 seconds the microphone listens for "yes" or "no" using the local Vosk engine loaded with a temporary `["yes", "no", "[unk]"]` grammar (zero latency, no API roundtrip). The normal wake path is paused. "Yes" runs that action once. "No", silence, or an unrelated phrase cancels the command. Surf then says "Cancelled."

The expanded panel shows the same question with Yes and No buttons. Either a spoken answer or a button counts. The first answer wins.

### Spoken replies

Surf speaks after it tries a command: success, a tool failure it could not recover from, an abort, or a cancellation. It does not speak when the gate says no, when speech-to-text fails, or when the network fails before the gate returns yes.

Speech playback and the 300 ms after it are paused for wake detection. Mute does not cut off a sentence that has already started.

## Failures

- No microphone, or permission denied: the status shows the problem. Surf does not quit. Unmute tries the device again.
- The local speech model is missing: first run downloads it. If the download fails, the status says so and listening stays off.
- Speech-to-text, the gate, or the tool model fails on the network: Surf retries that call once. Then it deletes the clip, sets the status to offline, writes an error log line, and keeps the wake listener running. It does not speak, because it never accepted a command.
- A tool or the tool model fails after the gate said yes: Surf speaks the failure and logs it.
- Text-to-speech fails: the status and the log still show the line. Listening resumes.
- An unknown tool name returns an error to the model. It does not throw away the command by itself.
- `agent-desktop` missing or a non-zero exit becomes a failed tool result with the envelope's error text.

## Browser control

This is the second build. Page work happens inside a browser extension because the accessibility tree does not reliably see page content. Menus, forms, cookie banners, and text on the page are available to a content script.

Chrome and Edge are the targets. Both load the same Manifest V3 extension.

### Local channel

Surf listens on `127.0.0.1` only. It does not bind `0.0.0.0`. The preferred port is `47321`. If that port is taken, Surf tries the next ports up to `47330` and remembers the one it bound.

The server is the `ws` package in the Electron main process. The extension has host permission for `http://127.0.0.1/*`. It opens a WebSocket to `ws://127.0.0.1:<port>/ws`.

A shared token stops other local programs from driving the browser. Pairing works like this:

1. You choose "Pair browser" in the expanded window.
2. Surf generates a one-time code and shows it.
3. You paste the code into the extension popup.
4. The extension sends the code to `POST http://127.0.0.1:<port>/pair`.
5. Surf returns a long-lived token. The extension stores it in `chrome.storage.local`.
6. The WebSocket's first message is `{ "type": "auth", "token": "<token>" }`. Any earlier message, or a bad token, closes the socket.
7. The extension sends a ping frame every 20 seconds to prevent Manifest V3 service worker hibernation.

"Disconnect browser" revokes the token. The extension must be paired again.

Messages are JSON text frames.

Desktop to extension:

```json
{ "id": "1", "type": "call", "tool": "open_tab", "args": { "url": "https://example.com" } }
```

Extension to desktop:

```json
{ "id": "1", "type": "result", "ok": true, "data": { "tabId": 12, "url": "https://example.com" } }
```

```json
{ "id": "1", "type": "result", "ok": false, "error": "no matching element" }
```

The extension may also send `{ "type": "event", "name": "disconnected" }` when the browser side drops. Calls time out after 20 seconds.

### Browser tools

The same agent loop gains these tools once the extension is connected. They are not registered in the first build.

| Tool                             | What it does                                                                                                             |
|----------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| `browser_open_window`            | Opens a window. An optional URL loads in it.                                                                             |
| `browser_open_tab`               | Opens a tab. An optional URL loads in it.                                                                                |
| `browser_focus`                  | Focuses a window or tab.                                                                                                 |
| `browser_navigate`               | Goes to a URL in the current tab.                                                                                        |
| `browser_click`                  | Clicks an element by accessible name or visible text.                                                                    |
| `browser_hover`                  | Hovers an element.                                                                                                       |
| `browser_type`                   | Types into the focused field or a named field.                                                                           |
| `browser_press`                  | Sends a key in the page, including find.                                                                                 |
| `browser_find`                   | Highlights a phrase in the page.                                                                                         |
| `browser_scroll`                 | Scrolls the page or a named region.                                                                                      |
| `browser_extract`                | Returns visible text, capped in size.                                                                                    |
| `browser_fill_form`              | Sets named fields.                                                                                                       |
| `browser_toggle`                 | Opens or closes a collapsible section.                                                                                   |
| `browser_rich_text`              | Applies bold, italic, a heading, or a list in a contenteditable region.                                                  |
| `browser_copy` / `browser_paste` | Copies or pastes the current selection through the extension clipboard APIs.                                             |
| `browser_choose_file`            | Sets a file input to a path you already confirmed.                                                                       |
| `browser_dismiss_cookies`        | Clicks a reject or accept control on a consent banner, using the choice saved in settings. The default choice is reject. |

Search is `browser_navigate` to the search URL, or a typed query in a focused search box. Google is `https://www.google.com/search?q=` plus the encoded query. Another engine is the same pattern with that engine's query URL. A phrase such as "Google 5 star restaurants in town" becomes a search URL. Surf does not guess a city. If the phrase needs a place and none was spoken, the spoken reply says so.

Login, single sign-on, and MFA use the same click and type tools. Surf does not store passwords and does not complete an MFA prompt. It focuses the prompt and says that it is waiting for you.

Booking pages, carts, profiles, and site settings use the same DOM tools. They are not separate integrations.

Cookie banners, carts, checkout, profile changes, and site settings that spend money or change an account use the same confirmation rule as delete, send, and pay.

File upload only accepts a path Surf asks you to confirm in the spoken question.

## Layout

```
Design.md
Plan.md
package.json
README.md
src/
  main.js            # Electron main, window, tray, loop
  preload.js         # narrow IPC bridge
  settings.js        # name, voice, safeStorage key, Vosk check
  audio.js           # pvrecorder, VAD, WAV clips
  wake.js            # Vosk grammar for the agent name
  stt.js             # POST /v1/stt (native fetch)
  gate.js            # POST /v1/responses (native fetch)
  agent.js           # tool loop, 8 rounds
  speech.js          # POST /v1/tts (native fetch)
  confirm.js         # spoken (Vosk) or clicked yes/no
  log.js             # 200-line activity log
  tools/
    desktop.js       # allowlisted agent-desktop stream
    browser.js       # phase 2, WebSocket calls
  bridge/
    server.js        # phase 2, 127.0.0.1 HTTP + WebSocket
renderer/
  index.html
  app.js
  styles.css         # drag regions configured
extension/           # phase 2
  manifest.json
  background.js      # ping heartbeat included
  content.js
  popup.html
test/
  gate.test.js
  wake-grammar.test.js
  safety.test.js
  cleanup.test.js
  agent-loop.test.js
  bridge-protocol.test.js
```

## Tests

Unit tests use Node's built-in test runner and fake STT, gate, tool, and TTS clients. They do not call the network and do not need a microphone.

They cover:

- The gate treats a schema failure as no.
- The wake grammar is exactly the saved name.
- Setup rejects an Out-of-Vocabulary name.
- `launch_app` rejects a raw path and does not execute `agent-desktop`.
- `press_keys` rejects Win+R, Win+X, and Alt+F4.
- Risky control names require confirmation.
- Audio files are deleted on no, on finish, and on exit.
- The tool loop stops at 8 rounds.
- Confirmation expires at 15 seconds.
- The activity log drops lines past 200 and never receives a log call for a gate result of no.
- Bridge messages with a bad token are rejected. Call and result JSON matches the shapes above.

A Windows-only test, skipped when `process.platform` is not `win32`, opens Notepad, types a sentence, and reads it back.

The microphone path is checked by hand: say the name and "open Notepad", then say a normal sentence and confirm that Surf stays quiet, leaves no WAV, and adds no log line. Mute the mic, speak the name, and confirm that nothing is captured.

## Success for the first build

- After you set a valid name and an API key, the compact window reads Listening and the mic button is on.
- Muting stops capture. Unmuting returns to Listening.
- Expanding the window shows "Now" and "Log".
- "Nova, open Notepad" launches Notepad when the agent is named Nova. The log gains a heard line, step lines, and a said line. The WAV is gone.
- "Nova, type hello" focuses Notepad and types hello, then Surf speaks a short confirmation.
- A sentence that is not a command leaves no audio file, produces no speech, and adds no log line.
- "Nova, stop" during a command aborts it. The Stop button does the same while muted.
- Closing a window waits for a spoken yes or the Yes button.

## Success for browser control

- After pairing, "Nova, google 5 star restaurants in town" opens a tab to a Google results page for that query, without inventing a city.
- The extension is the only component that touches the page.
- A machine that does not have the token cannot call the WebSocket.
- Checkout, payment, and account changes wait for a spoken yes or the Yes button.

## Out of scope

- Vision or screenshot clicking.
- A general shell, scripts, or the Run dialog.
- Firefox, until the Chromium extension is working.
- A spoken reply for phrases that are not commands.
- Saving microphone audio.
- Guessing unspoken details such as which town you mean.