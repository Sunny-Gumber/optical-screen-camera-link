# Optical Screen-to-Camera Link

Experimental visible-light data transfer using a normal laptop/mobile display as the transmitter and a normal camera as the receiver.

V1 deliberately prioritizes **correct decoding and measurements** over speed. Later versions will increase cell density, colour alphabet size, frame rate and eventually explore rolling-shutter timing.

## V1 baseline

- Logical optical ROI: `256 × 256`
- Cell size: `16 × 16`
- Grid: `16 × 16`
- Colour alphabet: `C16`
- Bits per colour symbol: `4`
- Data cells: `176`
- Optical envelope: `88 bytes/frame`
- Maximum encoded protocol packet: `86 bytes`
- Recommended DATA payload: `72 bytes`
- Packet integrity: `CRC32`
- Whole-transfer integrity: `CRC32`

## End-to-end flow

```text
Text / Binary
    ↓
Packetization + sequence + CRC32
    ↓
C16 symbol mapping
    ↓
256×256 optical frame
    ↓
Laptop/mobile screen
    ↓ visible light
Camera
    ↓
Bright-square ROI detection
    ↓
Perspective rectification
    ↓
Finder/orientation check
    ↓
Per-frame 16-colour calibration
    ↓
Cell classification
    ↓
Protocol CRC validation
    ↓
Packet reassembly
    ↓
Recovered text/data
```

## Run locally

Because the receiver uses the camera, serve the repository from a secure origin. `localhost` is accepted by modern browsers for local development.

```bash
python -m http.server 8080
```

Then open:

- Landing page: `http://localhost:8080/`
- Sender: `http://localhost:8080/apps/sender-web/`
- Receiver: `http://localhost:8080/apps/receiver-web/`

For a phone receiver, use the GitHub Pages HTTPS deployment instead of plain LAN HTTP, because mobile browsers normally require HTTPS for camera access.

## First physical test

1. Open the **Sender** on a laptop or second phone.
2. Enter a short message such as `HELLO OPTICAL`.
3. Press **Generate Frames**.
4. Select **1 fps**.
5. Press **Fullscreen Frame**.
6. Set the sender screen brightness high enough for stable camera exposure.
7. Open the **Receiver** on another device.
8. Press **Start Camera** and grant camera permission.
9. Point the camera at the whole bright sender square from roughly 20–60 cm away.
10. Keep the screen reasonably straight for the first test.
11. Watch for `ROI locked`, then valid `DATA` / `END` packets and finally `Complete`.

## Receiver V1 implementation

The receiver currently uses OpenCV.js for only the geometry stage:

- frame acquisition;
- bright quadrilateral detection;
- perspective warp.

The custom project code then performs:

- orientation selection using the four finder patterns;
- calibration using the 16 known C16 symbols emitted in every frame;
- normalized colour-space nearest-centroid classification;
- optical-envelope recovery;
- protocol CRC validation;
- session/sequence reassembly.

A decoded optical frame is **never trusted just because colours were classified**. The packet must also pass the protocol CRC32 check.

## Important V1 limitations

- V1 is tuned for a dark sender background and a clearly visible bright outer square.
- Automatic exposure/white balance can still change during a transfer.
- The C16 palette is intentionally conservative but is not yet optimized for every screen/camera pair.
- The receiver currently processes a few frames per second, not full camera FPS.
- There is no FEC yet; corrupt packets are rejected and must be seen again during the repeating sender cycle.
- File-save UI will be added after stable text transfer is demonstrated physically.

## Repository documents

- `PRD.md` — master product requirements.
- `Architecture.md` — master technical architecture and full target repository structure.
- `PRD-Architecture.md` — original baseline requirements.
- `Architecture-Essentials.md` — concise architectural principles.
- `agents.md` — implementation rules for coding agents.
- `chatgpt.md` — ChatGPT project guidance.

## Roadmap

```text
V1  Reliable low-speed C16 link
 ↓
V2  Better calibration + 8×8 cells + C32/C64
 ↓
V3  C128/C256 + confidence/erasure handling + FEC
 ↓
V4  4×4 / experimental 2×2 cells + higher refresh
 ↓
V5  Adaptive link negotiation
 ↓
V6  Rolling-shutter / advanced temporal experiments
```

The main performance metric is **useful recovered payload throughput**, not theoretical raw bitrate.
