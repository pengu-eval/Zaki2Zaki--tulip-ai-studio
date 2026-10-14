FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm install || npm install --legacy-peer-deps
RUN npm run build
RUN out=$(dirname "$(find dist build -name index.html -not -path '*/node_modules/*' | head -n 1)") && mkdir -p /static && cp -R "$out/." /static/

FROM nginx:alpine
COPY --from=build /static /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
