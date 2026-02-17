# Python Dependencies for Prix Six Engine

## Required Packages

The `prix_six_engine.py` newsletter generator requires the following Python packages:

### Core Dependencies
- `feedparser` - RSS feed parsing
- `firebase-admin` - Firestore database access
- `requests` - HTTP requests for weather API
- `google-genai` - Gemini 1.5 Pro LLM integration

### Security Dependencies
- **`bleach`** - HTML sanitization (GEMINI-003 fix)
  - **Required as of v1.57.2**
  - Prevents XSS from AI-generated HTML
  - Whitelists safe tags and attributes

## Installation

```bash
pip install feedparser firebase-admin requests google-genai bleach
```

Or use the requirements file (if created):
```bash
pip install -r prix_six_engine_requirements.txt
```

## Security Note

The `bleach` library is **mandatory** for production use. It sanitizes AI-generated HTML content before:
1. Writing to `prix_six_chat.html` output file
2. Storing in Firestore `app-settings/pub-chat` document

Without this sanitization, adversarial inputs (e.g., malicious RSS feed content) could inject XSS payloads that the AI might unknowingly include in its output.

## Version Requirements

- Python: 3.8 or higher
- bleach: 6.0.0 or higher (for Python 3.12+ compatibility)

## Related Files

- `prix_six_engine.py` - Main newsletter generator
- `service-account.json` - Firebase credentials (not in repo)
- `prix_six_chat.html` - Generated output file

---

**Last Updated:** 2026-02-13 (v1.57.2 - GEMINI-003 fix)
**Security Level:** CRITICAL - bleach dependency required for XSS prevention
