# Live voice, drawing and recorded feedback

Open the immersive viewer and use one instruction bar for GPT live voice, typing and drawing. The primary mic uses subscription-backed `gpt-live-1-codex` with native delegation to Hermes. Drawing works without starting or granting microphone capture. Offline recorded reviews are a separate secondary menu action. The Assistant still only proposes edits.

## Sub-features

- enter: The review action opens an immersive viewer around the existing mounted film. Phone projects enter it automatically. Outside review mode, R still focuses Replace.
- live: Tap the primary microphone; it awaits Hermes discovery/connection and opens subscribed GPT live audio. A retained recorded draft does not disable it. Permission and connection errors are visible, never a silent Whisper/API-key fallback.
- record: Choose Record offline review in the secondary menu, or hold R inside the mode. Releasing another playback key does not stop a click recording. Hold R stops when that key is released.
- clocks: The review keeps its own elapsed time and the editorial frame, including whether the seek is ready and presented.
- ink: Pencil works on idle and draft reviews without a microphone. A stroke is stored on the presented frame. Other frames stay clean; annotation-only drafts survive reload.
- replay: Stop leaves a playable WebM and retained draft; Send can finalize and deliver directly without a mandatory replay form. Conversation cards show replay and readable instructions, with edits behind a disclosure.
- transcript: An advertised review-specific backend supports complete takes up to 120 seconds and returns timestamped segments. Without it, the legacy route remains bounded to 30 seconds. Missing transcription retains the recording and requires usable typed direction before audio-only delivery.
- send: Send goes to the existing Assistant once. A busy, missing, or failed agent leaves the review in place. A stale revision asks for revalidation. Nothing is applied automatically.
- keep: The review is stored in this browser and, with a bridge, under the project's reviews folder. Download remains available. Closing the editor releases the microphone.
- identity: Switching videos parks each complete take under its original video identity. Typed-only idle drafts survive exit/reopen and reload, without overwriting newer input or saved recordings.

## How to get to it (user POV)

- Open a project on a phone, or choose the review action on desktop. Speech, text and pencil share one bar rather than separate Voice and Feedback workflows.
- Tap the microphone for GPT live voice. Allow browser microphone access; Hermes connects automatically. If an edit permission is requested, open Conversation and approve only the intended proposal write. Inspect/Apply remains a separate choice.
- Choose pencil to draw before or during speech. For an offline recording instead, use Record offline review in the secondary menu or hold R.
- Play, pause, or step with the existing keys while the take is recording.
- Pause, then draw on the preview.
- Choose Send while recording, or Stop to keep a draft. Open Conversation to replay or edit instructions. Agent selection and separate messages are secondary disclosures.
- Undo ink appears contextually; clear, download, discard, document undo/redo and Save are in the secondary menu. Exit returns to detailed editing.

## Driving it with Playwright

Preconditions: `node test/feedback-harness.mjs` builds a private demo library, starts a bridge with `--no-config` on a free port, and launches Chrome with a generated WAV as the fake microphone. `test/verify.mjs` runs that harness with its own library, separate from generation and reference fixtures. No paid model is called. The Assistant is `test/fixtures/review-agent.mjs`.

- Replace shortcut: `page.keyboard.press('r')` focuses `#replace-media`. After Exit, the same press focuses it again.
- Record: `page.click('[data-action="feedback"]')`, then `page.keyboard.down('r')`. Wait until `#feedback-toolbar` `dataset.phase` is `recording`.
- Playback: click `[data-action="play"]`, wait until `#preview-video` `currentTime` is greater than 0.2, then pause and press `ArrowLeft`.
- Presented frame: wait until `#canvas` `dataset.feedbackPresented` is `true` and its shown frame equals its target. Draw across `#feedback-ink`. Step away and require the ink canvas to have no pink pixels, then return and require them.
- Replay: `page.keyboard.up('r')`, wait for phase `draft`, and require `#feedback-replay` to decode. Require audible RMS above 0.01, ink in the movie, and more than one picture.
- Identity: the saved sidecar at `projects/<id>/reviews/<id>.json` has the project, video, base revision, source proxy, and transport entries with `seekReady` and `presented`. The WebM read from `/lib/...` matches the local blob size. The source movie hash and `project.json` hash stay unchanged.
- No agent: choose `[data-feedback="send"]` before connecting. The phase stays `draft`.
- Reload: reload, choose Feedback, and require the replay blob to return.
- Failed send: open `#review-agent-options`, connect `[data-agent="fixture"]`, open `#feedback-review-edit`, put `__FAIL__` in `#feedback-direction`, send, and require phase `draft` with the movie kept. The open title is not replaced.
- Busy send: open `#review-message-options`, send `__HOLD__` from `#ask`, send the review while that turn is open, and require the status to say busy. Release the hold file used by the fixture.
- Stale send: change the open title, send, choose `[data-feedback="revalidate"]`, and require phase `sent`. The proposal stays unapplied. The fixture log contains `fframestudio.review/1` and an image block, and does not contain the bridge token.
- Late permission: replace `getUserMedia` with a gate, hold R, release R, then grant. The granted tracks are ended and the phase is not `recording`.
- Unsupported capture: make `captureStream` return an empty stream and require the status to say the preview cannot be recorded.
- Voice collision: set the voice controller listening and require Record to refuse.
- Close: start Record, call `window.ffs.destroy()`, and require the microphone tracks to be ended.
- Layout: Check mounted-player identity, viewport bounds, portrait/landscape and actual screenshot/source-pixel similarity. A deliberate black overlay must fail the pixel gate. Conversation opens explicitly on phone and must not occlude the film during direct Send.
- Retention: Record A, exit, select B, record B, return to A and verify its original ID/movie/direction. After sending, type a new instruction, reopen and reload; require the new typed draft rather than the older recording.
- Cap: Temporarily reduce the review cap, record until automatic stop and require a complete transcript; recorder drain time must not inflate microphone duration.

## Gotchas

- `#canvas` is a DIV. The recording is a separate canvas. A seek that is not presented must not be treated as the target frame. `data-feedback-seek-ready` and `data-feedback-presented` are the visible proof.
- `/reference/review-transcribe` advertises a 120-second, 4 MB bound; `/reference/transcribe` stays 30 seconds. Both reject excessive duration without returning partial text. Segment timestamps are audio time, not invented source-frame or word-level alignment.
- Only microphone audio, not the full movie, is posted for transcription. The movie and sidecar are retained separately.
- Chrome needs `--use-fake-device-for-media-stream` and `--use-file-for-fake-audio-capture` for the audible proof. Do not replace `getUserMedia` on that path.
- The harness must see the same shared `bridge.json` bytes and mtime before and after. It passes `--no-config` and does not write the user's library.
- Set `TMPDIR` to a tmpfs with space before the harness. The browser run is not part of the syntax check.
- The default microphone is a generated tone and ACP uses a deterministic fixture. Set `FFS_FEEDBACK_AUDIO`, `FFS_FEEDBACK_RECORD_MS` and `FFS_EXPECT_TRANSCRIPT` with a configured local Whisper backend to exercise actual spoken audio. This still does not qualify a physical microphone or a live production-model turn.

## Real subscription acceptance

`test/live/app-smoke.mjs` is explicit opt-in, not a fixture test. Supply `FFS_LIVE_APP_BASE`, `FFS_LIVE_APP_TOKEN_FILE`, `FFS_LIVE_APP_AUDIO` and `FFS_LIVE_APP_OUT`; set `FFS_LIVE_APP_MOBILE=1` for phone-size automatic entry. It creates its own project copy, byte-checks copied media, draws without a mic, clicks the actual primary mic, sends generated speech through browser capture to GPT live, receives a real Hermes proposal, approves only that disposable proposal write, waits for an actual spoken final after agent completion, and confirms the document was not auto-applied. This does not qualify physical microphone hardware.

`node --test test/doc/live-voice.test.mjs test/live/live.test.mjs` covers lifecycle, scoped call ownership, duplicate delegation and explicit failures without provider calls. `python3 -m unittest test/live/test_helper.py` checks the read-only subscription resolver boundary. Never count those as live model acceptance.

Media copied through `/fs` must use `application/octet-stream`; otherwise the text-write path corrupts it. A cloned-proxy demuxer error must be checked against source/readback bytes before blaming the viewer.
