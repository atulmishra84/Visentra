FROM node:20-alpine AS builder
WORKDIR /build
ARG PLATFORM_HTML=agentRadarLaunch.html
COPY ${PLATFORM_HTML} ./index.html

FROM nginx:1.25-alpine
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/* && \
    mkdir -p /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp && \
    chmod -R 777 /var/cache/nginx && \
    chmod -R 777 /var/run && \
    touch /var/run/nginx.pid && \
    chmod 777 /var/run/nginx.pid
COPY --from=builder /build/index.html /usr/share/nginx/html/index.html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:80/health || exit 1
CMD ["nginx", "-g", "daemon off;"]
