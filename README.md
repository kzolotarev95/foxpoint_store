
# FoxPoint

FoxPoint storefront, cabinet, admin panel, and API in a single repo.

## Stack

- Next.js 15
- Fastify 5
- Prisma
- PostgreSQL
- Ubuntu 24.04 + Nginx + systemd for production

## Local development

```bash
npm install
npm run db:generate
npm run build
```

## VPS install without Docker

Plain install by IP only:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/install-vps.sh?v=$(date +%s)" | sudo bash
```

Install with domain and HTTPS:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/install-vps.sh?v=$(date +%s)" | sudo APP_DOMAIN=panel.example.com CERTBOT_EMAIL=you@example.com bash
```

Update on the server:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/update-vps.sh?v=$(date +%s)" | sudo bash
```

Remove services:

```bash
curl -fsSL "https://raw.githubusercontent.com/kzolotarev95/foxpoint_store/main/uninstall-vps.sh?v=$(date +%s)" | sudo bash
```

Full guide: [docs/VPS_SETUP.md](docs/VPS_SETUP.md)
