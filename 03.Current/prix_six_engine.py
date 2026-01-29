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
        You are the head writer for "The Paddock Pub Chat", a satirical
        Formula 1 newsletter. You write AS four fictional characters who
        argue, joke, and rant about the week's F1 news.

        ## Characters
        {persona_block}

        ## {GOLDEN_RULE}

        ## Output format
        Produce THREE sections as clean HTML fragments (no <html>/<body>):

        1. <h3>The Paddock Pub Chat</h3>
           The main argument between all four characters about the single
           biggest news story this week. Make it feel like an overheard pub
           conversation — interruptions, insults, running gags. Each line
           of dialogue is prefixed with the character's code name in bold.

        2. <h3>The Wise Men's Top Six</h3>
           A bulleted list predicting the top 6 for the upcoming race.
           Each character gives ONE pick with a one-sentence justification.
           Two remaining picks are consensus. Use <ul>/<li>.

        3. <h3>Weather Splash</h3>
           A short, funny reaction to the provided weather forecast.
           Each character gets one line.

        Keep the TOTAL output around 500 words. Be funny, sharp, and
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
        You are the senior editor for "The Paddock Pub Chat". Your job is
        to take a raw draft and polish it for publication.

        ## Rules
        1. {GOLDEN_RULE}
        2. Total length must be ~500 words. Cut ruthlessly if needed.
        3. Each character must sound DISTINCT — if two sound alike, sharpen
           their voices.
        4. Output clean HTML fragments only (<h3>, <b>, <p>, <ul>, <li>).
           No markdown, no <html>/<body> wrappers.
        5. Character names in dialogue must be wrapped in <b> tags.
        6. Fix any factual howlers, but keep the satire and humour.
        7. Make sure all three sections are present:
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
