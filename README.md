[![Build Status](https://github.com/johnwatson484/dream-league-videprinter/actions/workflows/build.yaml/badge.svg)](https://github.com/johnwatson484/dream-league-videprinter/actions/workflows/build.yaml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=johnwatson484_dream-league-videprinter&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=johnwatson484_dream-league-videprinter)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=johnwatson484_dream-league-videprinter&metric=bugs)](https://sonarcloud.io/summary/new_code?id=johnwatson484_dream-league-videprinter)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=johnwatson484_dream-league-videprinter&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=johnwatson484_dream-league-videprinter)
[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=johnwatson484_dream-league-videprinter&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=johnwatson484_dream-league-videprinter)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=johnwatson484_dream-league-videprinter&metric=coverage)](https://sonarcloud.io/summary/new_code?id=johnwatson484_dream-league-videprinter)
[![Dependabot](https://badgen.net/github/dependabot/johnwatson484/dream-league-videprinter)](https://github.com/johnwatson484/dream-league-videprinter/security/dependabot)

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
