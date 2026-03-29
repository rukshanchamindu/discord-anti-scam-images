# Discord Anti-Scam Images Bot

A highly optimized Discord bot that uses advanced OCR (Optical Character Recognition) to detect, block, and log scam messages containing images with banned text.

## Features
-   **Triple-Engine OCR**: Uses **Tesseract.js** for local fast scanning, **OCR.space** (with auto-compression to < 1MB) as a second-tier fallback, and **Google Gemini 2.5 Flash-Lite** as the ultimate fallback for complex patterns.
-   **Mass Batch Analysis**: Groups messages from users and analyzes them together to detect coordinated scam attempts.
-   **Modular Architecture**: Built with a clean, modular structure for easy extension of OCR engines and moderation logic.
-   **Performance Optimized**: 
    *   **Early-Exit Scan**: Stops analysis as soon as a scam is detected to save CPU/API costs.
    *   **Caching System**: Results are cached to avoid re-scanning the same images.
    *   **HEAD Request Pre-check**: Fast URL validation before downloading full image content.
    *   **Auto-Compression**: Automatically reduces image size/quality (using `sharp`) to fit within the 1MB limit for free OCR.space API usage.
-   **Configurable Moderation**: Automatically timeout users or delete messages based on trigger thresholds.

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Configuration

Create a `.env` file in the root directory. You can use `.env.example` as a template.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DISCORD_TOKEN` | Your Discord bot token | Required |
| `GEMINI_API_KEY` | Google AI Studio API Key (for Flash-Lite fallback) | Optional |
| `OCR_SPACE_API_KEY` | API Key from [ocr.space](https://ocr.space/ocrapi) | Optional |
| `BANNED_WORDS` | Comma-separated list of words to trigger moderation | - |
| `ALLOWED_CHANNELS` | List of channel IDs to scan (if whitelist) | - |
| `IS_WHITELIST` | Use `true` to only scan allowed channels, `false` for blacklist | `true` |
| `LOG_CHANNEL` | Channel ID where detection logs will be sent | Required |
| `SHOULD_DELETE` | Delete messages containing banned words | `true` |
| `SHOULD_PUNISH` | Timeout users for sending scam images | `true` |
| `TIMEOUT_DURATION` | Duration of timeout (e.g., `7d`, `24h`) | `7d` |
| `TRIGGERS_BEFORE_ACTION`| Number of detections before punishing a user | `1` |
| `MASS_ANALYZER_DELAY` | Time (ms) to wait for batching messages | `3000` |
| `DEBUG` | Enable detailed logs for analysis | `false` |

## Deployment

To run in development mode (with hot-reload):
```bash
npm run dev
```

To run in production:
```bash
npm start
```

## Credits
Based on the initial concept from [Saeraphinx/anti-scam-ocr](https://github.com/Saeraphinx/anti-scam-ocr). Significantly refactored and enhanced with modern OCR engines and modular architecture.
