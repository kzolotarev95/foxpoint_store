import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { configureBackupNginx, backupPageLocation, backupArchiveLocation } from "./configure-backup-nginx.mjs";

const server = locations => `server {\n    listen 8443 ssl;\n    server_name foxpoint.cc;\n    ssl_certificate /etc/letsencrypt/live/foxpoint.cc/fullchain.pem;\n${locations}\n    location / { proxy_pass http://127.0.0.1:3000; }\n}\n`;
const legacy = server(backupArchiveLocation);
const patched = configureBackupNginx(legacy);
assert.equal((patched.match(/location = \/admin\/backups \{/g) ?? []).length, 1);
assert(patched.includes("server_name foxpoint.cc;"));
assert(patched.includes("listen 8443 ssl;"));
assert(patched.includes("ssl_certificate /etc/letsencrypt/live/foxpoint.cc/fullchain.pem;"));
assert.equal(configureBackupNginx(patched), patched, "Running the fix twice must not duplicate locations");
for (const existing of ["", backupPageLocation, backupPageLocation + backupArchiveLocation, backupArchiveLocation + backupPageLocation]) {
  const result = configureBackupNginx(server(existing));
  assert.equal((result.match(/location = \/admin\/backups \{/g) ?? []).length, 1);
  assert.equal((result.match(/location \^~ \/admin\/backups\/ \{/g) ?? []).length, 1);
  assert.equal(configureBackupNginx(result), result);
}
const redirectServer = 'server {\n    listen 80;\n    return 301 https://$host$request_uri;\n}\n';
const multiServer = redirectServer + legacy + server("");
const multiResult = configureBackupNginx(multiServer);
assert(multiResult.startsWith(redirectServer));
assert.equal((multiResult.match(/location = \/admin\/backups \{/g) ?? []).length, 2);
assert.equal(configureBackupNginx(multiResult), multiResult);
for (const path of ["deploy/nginx/foxpoint.conf", "deploy/nginx/foxpoint-tls.conf"]) {
  const template = await readFile(path, "utf8");
  assert.equal(configureBackupNginx(template), template, "New-server templates must already include the fix");
}
console.log("PASS: upgrades the old backup location, preserves TLS/domain/ports, patches all proxy servers, is idempotent, and all installation templates contain the exact page location.");
