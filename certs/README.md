# TLS certificates (gitignored)

Place Let's Encrypt (or your CA) files here:

- `cert.pem` — full chain
- `key.pem` — private key

## Provision with certbot

```bash
sudo certbot certonly --standalone -d your-domain.example.com
sudo cp /etc/letsencrypt/live/your-domain.example.com/fullchain.pem certs/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.example.com/privkey.pem certs/key.pem
```

## Local development (self-signed)

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=localhost"
```
