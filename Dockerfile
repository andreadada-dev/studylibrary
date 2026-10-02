FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
COPY docker-entrypoint-study.sh /docker-entrypoint.d/40-studylibrary-config.sh
RUN chmod +x /docker-entrypoint.d/40-studylibrary-config.sh

EXPOSE 80
