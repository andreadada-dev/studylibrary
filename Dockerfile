FROM node:22-alpine AS verify
WORKDIR /src
COPY . .
RUN npm run ci

FROM nginx:1.27-alpine

COPY --from=verify /src/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=verify /src/index.html /usr/share/nginx/html/index.html
COPY --from=verify /src/styles.css /usr/share/nginx/html/styles.css
COPY --from=verify /src/app.js /usr/share/nginx/html/app.js
COPY --from=verify /src/config.js /usr/share/nginx/html/config.js
COPY --from=verify /src/manifest.webmanifest /usr/share/nginx/html/manifest.webmanifest
COPY --from=verify /src/robots.txt /usr/share/nginx/html/robots.txt
COPY --from=verify /src/sitemap.xml /usr/share/nginx/html/sitemap.xml
COPY --from=verify /src/js /usr/share/nginx/html/js
COPY --from=verify /src/data /usr/share/nginx/html/data
COPY --from=verify /src/docker-entrypoint-study.sh /docker-entrypoint.d/40-studylibrary-config.sh

RUN chmod +x /docker-entrypoint.d/40-studylibrary-config.sh

EXPOSE 80
