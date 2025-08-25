# Dream League Videprinter

Real-time videprinter for lower league English football.

## Providers
Supported data providers:
- mock (synthetic goals)
- live-score (https://live-score-api.com)

## Prerequisites

- Docker
- Docker Compose
- LiveScore API key and secret (if not using mocked data)

### LiveScore API setup
1. Create account & get key + secret.

2. Export credentials and enable LiveScore (set USE_MOCK=false):

```bash
export LIVE_SCORE_KEY=your_key
export LIVE_SCORE_SECRET=your_secret
export USE_MOCK=false
```

3. Start app and open /live-scores.

Switch back to mock at any time (or default):
```bash
export USE_MOCK=true
```

## Running application

### Docker

```
docker compose build
docker compose up
```
