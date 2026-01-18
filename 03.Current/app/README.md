# Prix Six

### Fantasy Formula 1 Prediction League

Pick your top 6 drivers. Score points. Beat your friends.

---

## What is Prix Six?

Prix Six is a web-based fantasy F1 game where you predict which drivers will finish in the top 6 positions for each race. The closer your predictions match reality, the more points you earn.

**Simple rules:**
- Pick 6 drivers in order before qualifying starts
- Exact position match = maximum points
- Right driver, wrong position = partial points
- All 6 correct = bonus points

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript |
| Styling | Tailwind CSS, shadcn/ui |
| Backend | Firebase (Auth, Firestore) |
| AI | Google Genkit |
| Deployment | Firebase Hosting |

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- Firebase project

### Installation

```bash
# Clone the repo
git clone https://github.com/aaronukgarcia/03-PrixSix.git
cd 03-PrixSix/03.Current/app

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Firebase config

# Run development server
npm run dev
```

Open [http://localhost:9002](http://localhost:9002) in your browser.

---

## Environment Variables

Create a `.env.local` file with your Firebase configuration:

```env
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
```

> Never commit `.env.local` to git. It contains secrets.

---

## Features

- **Team Creation** - Sign up with email, get a 6-digit PIN
- **Driver Picker** - Click to add, drag to reorder your top 6
- **Live Standings** - See where you rank against other players
- **Race Results** - View points breakdown for each race
- **Admin Panel** - Enter official results, manage teams
- **Mobile Friendly** - Works on any device

---

## Project Structure

```
src/
  app/
    (auth)/        # Login, signup, forgot PIN
    (app)/         # Main app pages (dashboard, predictions, standings)
  components/
    ui/            # shadcn/ui components
    layout/        # App sidebar, navigation
  firebase/        # Firebase hooks and providers
  lib/             # Data, utilities, scoring logic
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 9002 |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type checking |

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Author

Built by Aaron Garcia

---

<p align="center">
  <strong>May the best predictor win!</strong>
</p>
