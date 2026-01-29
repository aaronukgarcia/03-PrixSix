"""
prix_six_engine.py — "The Paddock Pub Chat" satirical F1 newsletter generator.

Fetches F1 news via RSS + weather via Open-Meteo, then uses a two-phase LLM
pipeline (Gemini 1.5 Pro) to produce an HTML newsletter voiced by four
fictional personas.
"""

import datetime
import html
import json
import os
import re
import textwrap
from difflib import SequenceMatcher

import feedparser
import firebase_admin
from firebase_admin import credentials, firestore as admin_firestore
import requests
from google import genai

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RSS_FEEDS = [
    "https://www.planetf1.com/feed",
    "https://feeds.bbci.co.uk/sport/formula1/rss.xml",
    "https://www.skysports.com/rss/12040",           # Sky Sports F1
    "https://www.gpblog.com/en/rss/index.xml",
    "https://www.motorsportweek.com/feed/",
    "https://racer.com/f1/feed/",
]

# Silverstone default — swap lat/lon for the next race venue
WEATHER_LAT = 52.07
WEATHER_LON = -1.02
WEATHER_LOCATION_NAME = "Silverstone"

WEATHER_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={WEATHER_LAT}&longitude={WEATHER_LON}"
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
    "weathercode&timezone=Europe%2FLondon&forecast_days=3"
)

PERSONAS = {
    "THE APE": (
        "Loud, aggressive, obsessed with POWER. Hates regulations. "
        "Frequently shouts single words in capitals. Thinks every rule "
        "change is a conspiracy against proper racing."
    ),
    "SLOWWORM": (
        "Pedantic know-it-all. Loves citing historical precedents and "
        "obscure regulations. Speaks in long, meandering sentences. "
        "Will always find a way to mention a 1970s Grand Prix."
    ),
    "THE HAMSTER": (
        "Excitable, high-pitched energy. Loves drama, crashes, and "
        "anything that goes wrong. Uses far too many exclamation marks. "
        "Gets distracted easily."
    ),
    "THE MONKEY": (
        "Technical driver at heart. Obsessed with 'skids', steering feel, "
        "and the sensation of driving. Judges every situation through the "
        "lens of car control and throttle response."
    ),
}

GOLDEN_RULE = (
    "ABSOLUTE RULE — You must NEVER use the real names Jeremy, James, "
    "Richard, or Chris (or any obvious reference to them). The characters "
    "are ONLY referred to by their code names: THE APE, SLOWWORM, "
    "THE HAMSTER, and THE MONKEY. Breaking this rule is instant "
    "disqualification."
)

MAX_NEWS = 10
TITLE_SIMILARITY_THRESHOLD = 0.6

# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------


def fetch_weather() -> dict:
    """Return a 3-day forecast dict from Open-Meteo."""
    try:
        resp = requests.get(WEATHER_URL, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        daily = data.get("daily", {})
        days = []
        for i, date in enumerate(daily.get("time", [])):
            days.append(
                {
                    "date": date,
                    "max_temp_c": daily["temperature_2m_max"][i],
                    "min_temp_c": daily["temperature_2m_min"][i],
                    "precip_pct": daily["precipitation_probability_max"][i],
                    "code": daily["weathercode"][i],
                }
            )
        return {"location": WEATHER_LOCATION_NAME, "days": days}
    except Exception as exc:
        return {"location": WEATHER_LOCATION_NAME, "error": str(exc), "days": []}


# ---------------------------------------------------------------------------
# News
# ---------------------------------------------------------------------------


def fetch_news() -> list[dict]:
    """Fetch stories from all RSS feeds, return flat list of dicts."""
    stories = []
    for url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:8]:  # cap per-source
                stories.append(
                    {
                        "title": entry.get("title", ""),
                        "summary": entry.get("summary", ""),
                        "link": entry.get("link", ""),
                        "source": feed.feed.get("title", url),
                    }
                )
        except Exception:
            continue
    return stories


def deduplicate_stories(stories: list[dict]) -> list[dict]:
    """Remove near-duplicate stories by title similarity, keep top N."""
    unique: list[dict] = []
    for story in stories:
        dominated = False
        for kept in unique:
            ratio = SequenceMatcher(
                None,
                story["title"].lower(),
                kept["title"].lower(),
            ).ratio()
            if ratio > TITLE_SIMILARITY_THRESHOLD:
                dominated = True
                break
        if not dominated:
            unique.append(story)
        if len(unique) >= MAX_NEWS:
            break
    return unique


# ---------------------------------------------------------------------------
# LLM Client
# ---------------------------------------------------------------------------


VERTEX_PROJECT = "studio-6033436327-281b1"
VERTEX_LOCATION = "us-central1"
SERVICE_ACCOUNT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "service-account.json"
)


def _build_client() -> genai.Client:
    """Build a google-genai client.

    Priority: GOOGLE_API_KEY env var → Vertex AI with service-account.json.
    """
    api_key = os.environ.get("GOOGLE_API_KEY")
    if api_key:
        return genai.Client(api_key=api_key)

    # Vertex AI with service account credentials
    if os.path.exists(SERVICE_ACCOUNT_PATH):
        os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", SERVICE_ACCOUNT_PATH)

    return genai.Client(
        vertexai=True,
        project=VERTEX_PROJECT,
        location=VERTEX_LOCATION,
    )


def call_llm(system_prompt: str, user_content: str, *, model: str = "gemini-2.5-flash-lite") -> str:
    """Send a single request to the LLM and return the text response."""
    client = _build_client()
    response = client.models.generate_content(
        model=model,
        contents=user_content,
        config=genai.types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.9,
        ),
    )
    text = response.text
    # Strip markdown code fences the LLM sometimes wraps around HTML
    text = re.sub(r"^```(?:html)?\s*\n?", "", text.strip())
    text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Two-Phase Generation
# ---------------------------------------------------------------------------


def _build_drafter_system_prompt() -> str:
    persona_block = "\n".join(
        f"- **{name}**: {desc}" for name, desc in PERSONAS.items()
    )
    return textwrap.dedent(f"""\
        THE PADDOCK LUXE ENGINE
        =======================
        You are an AI Editorial Designer for a premium automotive journal.
        Your task is to transform raw "Pub Chat" dialogue into a high-end,
        luxury digital layout rendered as clean HTML fragments.

        ## 1. Tone & Voice
        Aesthetic: High-contrast, sophisticated, and clean. Think The Rake
        or Motorsport Magazine.

        ## Characters
        {persona_block}
        Maintain their distinct voices (Ape = Raw/Loud, Slowworm = Academic/
        Verbose, Hamster = Chaotic/Energetic, Monkey = Sensory/Poetic).

        ## {GOLDEN_RULE}

        ## 2. Layout Protocol (HTML)
        Output ONLY clean HTML fragments — no <html>, <head>, or <body> tags.
        Follow this visual hierarchy strictly:

        A. HEADER BLOCK
           Open with <hr>, then an emoji (use only one of: &#127951; &#127937;
           or &#127961;), followed by an <h1> in ALL CAPS for the title.
           Immediately after, an <h3><em>stand-first summary</em></h3> that
           acts as a one-sentence editorial lede.

        B. HERO QUOTE
           Every issue MUST feature one standout quote using:
           <blockquote>"Quote text" — <strong>CHARACTER</strong></blockquote>
           Pick the single most memorable line from the dialogue.

        C. THE PADDOCK PUB CHAT — main section
           Use an <h2> heading, then render all dialogue as an HTML
           <table> with two columns:
           - Column 1: <strong>CHARACTER NAME</strong> (ALL CAPS, bold)
           - Column 2: Open with a short "High-Impact Summary" in quotes
             (one punchy sentence), then the synthesis of their argument.
           This is the main argument between all four characters about the
           biggest news story. Make it feel like an overheard pub conversation
           — interruptions, insults, running gags.

        D. THE WISE MEN'S TOP SIX
           Use an <h2> heading, then a NUMBERED list (<ol><li>) to imply
           a definitive hierarchy. Each character gives ONE pick with a
           one-sentence justification. Two remaining picks are consensus.

        E. WEATHER SPLASH
           Use an <h2> heading. A short, funny reaction to the provided
           weather forecast — each character gets one line.

        F. SECTION BREAKS
           Use <hr> between each major content block to create clear
           visual separation.

        ## 3. Palette & Accents
        - Units: Render plain text — write 5°C or 18%%, never LaTeX.
        - Keywords: Wrap key automotive terms in <strong> tags to create
          visual anchors (e.g. <strong>aerodynamic efficiency</strong>,
          <strong>power unit</strong>, <strong>grip</strong>).
        - Character names in dialogue must ALWAYS be in
          <strong>ALL CAPS</strong>.

        ## 4. Constraints
        Keep the TOTAL output around 500–600 words. Be funny, sharp, and
        irreverent — but never cruel toward real people.
    """)


def phase_a_draft(news: list[dict], weather: dict) -> str:
    """Phase A: generate the raw newsletter draft."""
    news_block = "\n".join(
        f"- [{s['title']}]({s['link']}): {s['summary'][:200]}"
        for s in news
    )
    weather_block = json.dumps(weather, indent=2)

    user_content = textwrap.dedent(f"""\
        ## This week's F1 news
        {news_block}

        ## Weather forecast for {weather.get('location', 'the circuit')}
        {weather_block}

        Now write the newsletter.
    """)

    system_prompt = _build_drafter_system_prompt()
    return call_llm(system_prompt, user_content)


def phase_b_edit(draft: str) -> str:
    """Phase B: QA pass — tighten, enforce rules, polish HTML."""
    editor_prompt = textwrap.dedent(f"""\
        You are the senior editor for "The Paddock Pub Chat" — a premium
        automotive editorial. Your job is to take a raw draft and polish it
        into a publication-ready luxury layout.

        ## Rules
        1. {GOLDEN_RULE}
        2. Total length must be ~500–600 words. Cut ruthlessly if needed.
        3. Each character must sound DISTINCT — if two sound alike, sharpen
           their voices.
        4. Output clean HTML fragments only. No markdown, no <html>/<body>.

        ## Layout Checklist — enforce all of these:
        - HEADER: <hr> then emoji, then <h1> in ALL CAPS, then
          <h3><em>stand-first summary</em></h3>.
        - HERO QUOTE: Exactly one <blockquote> with the best line:
          <blockquote>"Quote" — <strong>CHARACTER</strong></blockquote>
        - PUB CHAT section: <h2> heading, dialogue in an HTML <table>
          (col 1 = <strong>CHARACTER</strong> all-caps, col 2 = summary
          in quotes then argument synthesis).
        - TOP SIX section: <h2> heading with <ol><li> numbered list.
        - WEATHER SPLASH: <h2> heading, one line per character.
        - <hr> separators between every major content block.
        - <strong> tags on key automotive terms (aerodynamic efficiency,
          power unit, grip, downforce, etc.) as visual anchors.
        - Units rendered as plain text: 5°C, 18%%, never LaTeX.
        - Character names ALWAYS <strong>ALL CAPS</strong>.
        5. Fix any factual howlers, but keep the satire and humour.
        6. All three sections must be present:
           "The Paddock Pub Chat", "The Wise Men's Top Six", "Weather Splash".
    """)

    return call_llm(editor_prompt, f"## DRAFT TO EDIT\n\n{draft}")


# ---------------------------------------------------------------------------
# HTML Output
# ---------------------------------------------------------------------------

VOTING_FOOTER = """\
<div style="text-align:center; margin-top:40px; padding:20px;
            border-top:2px solid #e10600;">
  <p style="font-size:18px; font-weight:bold; color:#1a1a2e;">
    Rate this issue
  </p>
  <a href="https://api.prixsix.com/vote?type=love"
     style="display:inline-block; margin:8px 12px; padding:12px 28px;
            background:#00d200; color:#fff; text-decoration:none;
            border-radius:6px; font-weight:bold; font-size:16px;">
    &#127937; Chequered Flag (Love it)
  </a>
  <a href="https://api.prixsix.com/vote?type=hate"
     style="display:inline-block; margin:8px 12px; padding:12px 28px;
            background:#e10600; color:#fff; text-decoration:none;
            border-radius:6px; font-weight:bold; font-size:16px;">
    &#x1F3F4; Black Flag (Disqualified)
  </a>
</div>
"""


def build_html(body_html: str) -> str:
    """Wrap the newsletter body in a full HTML document with inline CSS."""
    date_str = datetime.date.today().strftime("%d %B %Y")
    return textwrap.dedent(f"""\
        <!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>The Paddock Pub Chat — {html.escape(date_str)}</title>
        <style>
          body {{
            max-width: 680px; margin: 0 auto; padding: 24px;
            font-family: Georgia, 'Times New Roman', serif;
            background: #f9f9f9; color: #1a1a2e; line-height: 1.6;
          }}
          h1 {{
            text-align: center; color: #e10600;
            border-bottom: 3px solid #e10600; padding-bottom: 8px;
          }}
          h3 {{ color: #15151e; margin-top: 28px; }}
          b {{ color: #e10600; }}
          ul {{ padding-left: 20px; }}
          li {{ margin-bottom: 6px; }}
          .date {{ text-align: center; color: #666; font-size: 14px; }}
        </style>
        </head>
        <body>
        <h1>&#127937; The Paddock Pub Chat</h1>
        <p class="date">{html.escape(date_str)}</p>
        {body_html}
        {VOTING_FOOTER}
        </body>
        </html>
    """)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

OUTPUT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "prix_six_chat.html"
)


# ---------------------------------------------------------------------------
# Firestore
# ---------------------------------------------------------------------------


def write_to_firestore(body_html: str) -> None:
    """Write the newsletter HTML body to Firestore for the admin panel.

    Uses the same service-account.json already present for Vertex AI auth.
    Non-fatal: catches and logs errors without aborting the pipeline.
    """
    try:
        if not firebase_admin._apps:
            cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
            firebase_admin.initialize_app(cred)

        db = admin_firestore.client()
        db.collection("app-settings").document("pub-chat").set(
            {
                "content": body_html,
                "lastUpdated": admin_firestore.SERVER_TIMESTAMP,
                "updatedBy": "prix_six_engine",
            },
            merge=True,
        )
        print("Firestore — pub-chat content updated")
    except Exception as exc:
        print(f"Firestore write failed (non-fatal): {exc}")


def main():
    print("Fetching weather...")
    weather = fetch_weather()

    print("Fetching news...")
    raw_news = fetch_news()
    news = deduplicate_stories(raw_news)
    print(f"  {len(raw_news)} stories fetched, {len(news)} after dedup.")

    print("Phase A — drafting newsletter...")
    draft = phase_a_draft(news, weather)

    print("Phase B — editorial QA pass...")
    polished = phase_b_edit(draft)

    print("Building HTML...")
    full_html = build_html(polished)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(full_html)

    print(f"Saved to {OUTPUT_PATH}")

    print("Writing to Firestore...")
    write_to_firestore(polished)

    print("Done.")


if __name__ == "__main__":
    main()
