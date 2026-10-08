import { readFile, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const backupPageLocation = `
    # Prevent the /admin/backups <-> /admin/backups/ redirect loop.
    location = /admin/backups {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
`;
export const backupArchiveLocation = `
    location ^~ /admin/backups/ {
        client_max_body_size 20g;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
`;
export function configureBackupNginx(original) {
  // Upgrade existing installations too; a prefix location alone redirects the page before Next.js sees it.
  const updated = original.split(/(?=^[ \t]*server\s*\{)/m).map(server => {
    if (!/^[ \t]*server\s*\{/m.test(server)) return server;
    const page = /location\s*=\s*\/admin\/backups\s*\{/.test(server);
    const archives = /^[ \t]*location\s+\^~\s+\/admin\/backups\/\s*\{/m;
    if (archives.test(server)) return page ? server : server.replace(archives, match => `${backupPageLocation}\n${match}`);
    return server.replace(/\n[ \t]*location\s+\/(?:\s|\{)/, match => `${page ? "" : backupPageLocation}${backupArchiveLocation}${match}`);
  }).join("");
  if (!/location\s*=\s*\/admin\/backups\s*\{/.test(updated)) throw new Error("FoxPoint Nginx location not found; configuration was not changed.");
  return updated;
}

export async function applyBackupNginx() {
  const path = "/etc/nginx/sites-available/foxpoint";
  const original = await readFile(path, "utf8");
  const updated = configureBackupNginx(original);
  if (updated === original) { console.log("Backup Nginx routes already configured."); return; }
  const backup = `${path}.before-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await copyFile(path, backup);
  await writeFile(path, updated);
  if (spawnSync("nginx", ["-t"], { stdio: "inherit" }).status !== 0) { await writeFile(path, original); throw new Error("Nginx rejected the backup routes; previous configuration restored."); }
  if (spawnSync("systemctl", ["reload", "nginx"], { stdio: "inherit" }).status !== 0) {
    await writeFile(path, original);
    spawnSync("systemctl", ["reload", "nginx"], { stdio: "inherit" });
    throw new Error("Nginx reload failed; previous configuration restored.");
  }
  console.log(`Backup routes fixed. Nginx configuration backup: ${backup}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await applyBackupNginx();
