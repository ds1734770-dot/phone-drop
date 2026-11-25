# PhoneDrop

Your iPhone becomes a remote mic, camera and file sender for your Mac. Click a text box on the Mac, send something from the phone, and it lands in that box.

> **Platform:** this first version is **Apple only**: an **iPhone** paired with a **Mac** (built and tested on a Mac mini). Android and Windows are not supported yet.

## What it does

The phone screen is three round buttons in a column:

- **Speak** (mic): tap to start, tap again to stop. The words you said are typed on the Mac. While you speak, a live caption grows out of the Dynamic Island (or drops from the top edge on iPhones without one).
- **Video**: opens the camera, then sends the clip to the Mac.
- **Files**: pick photos or files to send.
- A small **Return** button presses Enter on the Mac.

Sent files are saved in `~/PhoneDrop` and their path is pasted into the focused field. That makes it handy for feeding screenshots, clips and voice prompts into a terminal or a coding agent.

## How it works

```
iPhone (Home Screen web app) --HTTPS via Tailscale--> Mac (server.mjs on 127.0.0.1)
                                                       |- saves the file to ~/PhoneDrop
                                                       '- pastes text or the file path into the focused field
```

- **No dependencies.** One Node.js file on the Mac and a static web app for the phone.
- **Private by default.** The server listens only on `127.0.0.1`. [Tailscale](https://tailscale.com) is the only way in, so only your own devices can reach it.
- **PIN protected.** An 8-digit PIN is created on first run. After 5 wrong PINs everyone is locked out for a few minutes.
- **Always on.** A macOS LaunchAgent starts it at login and restarts it if it stops.

## Requirements

- A Mac running macOS with **Node.js 20 or newer** (`node -v`)
- An iPhone with Safari (Dictation turned on for Speak: Settings > General > Keyboard > *Enable Dictation*)
- A free **Tailscale** account, with Tailscale installed on both devices

## Installation

### 1. Get the code (on the Mac)

```bash
git clone https://github.com/ds1734770-dot/phone-drop.git
cd phone-drop
```

### 2. Set up Tailscale

1. Install Tailscale on the Mac and on the iPhone, and sign in to **the same account** on both: https://tailscale.com/download
2. In the [Tailscale admin console](https://login.tailscale.com/admin/dns), turn on **MagicDNS** and **HTTPS Certificates**.
3. On the Mac: Tailscale menu bar icon > Settings > turn on **Start at login**.

### 3. Turn on auto-start

```bash
sh scripts/autostart.sh install
```

This starts PhoneDrop now and every time you log in. Your PIN is printed in the log and saved in `config.json`:

```bash
cat config.json
```

### 4. Publish it to your tailnet

```bash
tailscale serve --bg 8787
```

It prints a link like `https://your-mac.your-tailnet.ts.net`. This setting survives restarts.

> Use `serve`, **never** `funnel`. Funnel puts the app on the public internet.

If `tailscale` is not found, use the full path: `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 8787`

### 5. Allow pasting on the Mac

macOS blocks apps from typing into other apps until you allow it:
System Settings > Privacy & Security > **Accessibility** > add and turn on the `node` program (the path is printed by step 3).
Until you do, the phone shows "paste blocked". After a Node upgrade, allow it again.

### 6. Install it on the iPhone

1. Open the link from step 4 in **Safari**.
2. Type the PIN.
3. Share > **Add to Home Screen**.

Done. Open PhoneDrop from the Home Screen like any other app.

### 7. Keep the Mac reachable

- **Sleep:** a sleeping Mac can't receive anything. System Settings > Energy (or Battery > Options) > turn on *Prevent automatic sleeping when the display is off*.
- **After a restart:** the server starts when you **log in**. If FileVault is on, someone has to log in once after each restart.

## Use it

1. On the Mac, click the terminal or text box you want to type into.
2. On the phone, tap **Speak** and talk, or tap **Files** / **Video**.
3. The text or the file's path appears on the Mac. Tap **Return** to press Enter.

## Manage the service

```bash
sh scripts/autostart.sh status      # is it running?
sh scripts/autostart.sh uninstall   # turn auto-start off
sh scripts/autostart.sh install     # turn it back on (also after moving the folder)
```

Log file: `~/Library/Logs/PhoneDrop.log`. To run it by hand instead, stop auto-start and run `npm start`.

## Project files

- `server.mjs`: the Mac server (no dependencies)
- `public/`: the phone web app (`index.html`, `style.css`, `app.js`, manifest, icons)
- `scripts/autostart.sh`: installs the macOS LaunchAgent
- `scripts/make_icons.py`: regenerates the app icons
- `config.json`: your PIN, port and drop folder (created on first run, never committed)

## Roadmap

- Android phone app and Windows / Linux desktop support
- Optional on-Mac transcription (Whisper) as a fallback for Speak
- Video: extract frames and a transcript so a terminal agent can "see" the clip

## License

MIT. See [LICENSE](LICENSE).
