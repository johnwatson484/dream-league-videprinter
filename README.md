# Dream League Videprinter
Quick start new Node.js project using Hapi.js.

## Prerequisites

Either:
- Docker
- Docker Compose

Or:
- Node 22+

## Running application
### Docker
```
docker compose build
docker compose up
```

### Node
```
node app
```
Or:
```
nodemon app
```

# Dream League Videprinter

Real-time videprinter for lower league English football.

## Providers
Supported data providers:
- mock (synthetic goals)
- live-score (https://live-score-api.com)

## LiveScore API setup
1. Create account & get key + secret.
2. Export credentials and enable LiveScore (set USE_MOCK=false):
```bash
export LIVE_SCORE_KEY=your_key
export LIVE_SCORE_SECRET=your_secret
export USE_MOCK=false
```
3. Set league IDs either by editing `dataSource.liveScore.leagues` in `src/config.js` or via env vars (comma separated):
```bash
export LIVE_SCORE_LEAGUES_CHAMPIONSHIP=149
export LIVE_SCORE_LEAGUES_LEAGUE_ONE=150
export LIVE_SCORE_LEAGUES_LEAGUE_TWO=151
export LIVE_SCORE_LEAGUES_FA_CUP=178
export LIVE_SCORE_LEAGUES_LEAGUE_CUP=179
```
4. Start app and open /live-scores.

Switch back to mock at any time (or default):
```bash
export USE_MOCK=true
```
