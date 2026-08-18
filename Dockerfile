# Statyka (HTML/CSS/JS) — caly fetch pogody dzieje sie w przegladarce klienta
# wprost do Open-Meteo/IMGW (oba CORS: *, bez klucza), wiec obraz nie
# potrzebuje zadnego runtime'u aplikacyjnego, tylko serwera plikow.
FROM nginx:alpine

COPY index.html style.css app.js /usr/share/nginx/html/

# Domyslny port obrazu nginx (80) wystarcza -- kontener trafia do sieci
# `edge` w infra/docker-compose.yml, bez publikowanych portow na hoscie.
