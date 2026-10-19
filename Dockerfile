# Obraz do hostingu (Railway, Render, Fly.io, własny serwer z Dockerem).
FROM node:22-slim
WORKDIR /app
COPY . .
# Baza gry leży na trwałym dysku podpiętym pod /data, więc przetrwa aktualizacje.
# Hosting serwuje grę przez HTTPS i pośredniczący serwer, stąd bezpieczne ciasteczka i zaufanie do X-Forwarded-For.
ENV NODE_ENV=production DB_FILE=/data/game.db COOKIE_SECURE=1 TRUST_PROXY=1
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
