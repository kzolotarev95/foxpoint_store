"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Job = { id: string; kind: "create" | "upload" | "restore"; status: string; step: string; createdAt: string; bytes?: number; error?: string; targetUrl?: string;
  manifest?: { createdAt: string; publicUrl: string; postgresMajor: number; tables: Array<{ name: string; rows: number }>; systemFiles: string[] } };
type Snapshot = { jobs: Job[]; busy: boolean; restoreAvailable: boolean; error?: string };
const api = "/admin/backups/api";
const size = (bytes: number) => bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} ГБ` : `${(bytes / 1024 ** 2).toFixed(1)} МБ`;

export function AdminBackups({ initial }: { initial: Snapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [error, setError] = useState(initial.error ?? "");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadPassword = useRef<HTMLInputElement>(null);
  const requestRunning = useRef(false);
  const activeRestore = snapshot.jobs.find(job => job.kind === "restore" && job.status === "running");
  const busy = creating || uploading || Boolean(deleting) || snapshot.busy || Boolean(activeRestore);

  async function refresh() {
    try {
      const response = await fetch(api, { cache: "no-store" });
      if (response.status === 401) { setError("Войдите в админ-панель повторно, чтобы увидеть список бэкапов."); return; }
      if (response.ok) setSnapshot(await response.json());
    } catch { if (!activeRestore) setError("Не удалось обновить список бэкапов."); }
  }
  useEffect(() => { const timer = setInterval(() => { void refresh(); }, 3000); return () => clearInterval(timer); }); // Captures the latest restore state each render.

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestRunning.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    if (values.get("password") !== values.get("repeat")) { setError("Пароли архива не совпадают."); return; }
    requestRunning.current = true; setCreating(true); setError(""); setMessage("");
    try {
      const response = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: values.get("password") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      form.reset(); setMessage("Создание полного бэкапа началось. Готовый файл появится в списке ниже."); await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось создать бэкап."); }
    finally { setCreating(false); requestRunning.current = false; }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    const password = uploadPassword.current?.value ?? "";
    if (!file || requestRunning.current) return;
    if (!file.name.endsWith(".foxbackup")) { setError("Выберите полный архив .foxbackup."); return; }
    requestRunning.current = true; setUploading(true); setUploadProgress(0); setError(""); setMessage("");
    try {
      const result = await new Promise<{ id: string }>((accept, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", `${api}/upload`);
        request.setRequestHeader("Content-Type", "application/octet-stream");
        request.setRequestHeader("X-Backup-Password", btoa(String.fromCharCode(...new TextEncoder().encode(password))));
        request.upload.onprogress = progress => { if (progress.lengthComputable) setUploadProgress(Math.round(progress.loaded / progress.total * 100)); };
        request.onerror = () => reject(new Error("Загрузка прервалась. Текущая панель не изменена."));
        request.onload = () => { try { const payload = JSON.parse(request.responseText); request.status >= 200 && request.status < 300 ? accept(payload) : reject(new Error(payload.error ?? "Архив не принят.")); } catch { reject(new Error("Не удалось проверить загруженный архив.")); } };
        request.send(file);
      });
      setSelected(result.id); setMessage("Полный архив проверен. Для замены текущей панели заполните подтверждение восстановления.");
      if (uploadPassword.current) uploadPassword.current.value = "";
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось загрузить архив."); }
    finally { setUploading(false); requestRunning.current = false; }
  }

  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || requestRunning.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    requestRunning.current = true; setCreating(true); setError(""); setMessage("");
    try {
      const response = await fetch(`${api}/${selected}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: values.get("password"), targetUrl: values.get("targetUrl"), confirmation: values.get("confirmation") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setTargetUrl(result.targetUrl); form.reset(); setMessage("Восстановление началось. Во время сохранения текущего состояния и переключения панель будет недоступна; дождитесь завершения и войдите с данными из бэкапа."); await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось начать восстановление."); }
    finally { setCreating(false); requestRunning.current = false; }
  }

  async function deleteBackup(job: Job) {
    if (requestRunning.current || busy || deleteCandidate !== job.id) return;
    requestRunning.current = true; setDeleting(job.id); setError(""); setMessage("");
    try {
      const response = await fetch(`${api}/${job.id}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "УДАЛИТЬ" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDeleteCandidate(null);
      if (selected === job.id) setSelected(null);
      setSnapshot(previous => ({ ...previous, jobs: previous.jobs.filter(item => item.id !== job.id) }));
      setMessage(result.freedBytes ? `Архив удалён с сервера. Освобождено ${size(result.freedBytes)}.` : "Запись удалена. Файлов этого архива на сервере больше нет.");
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось удалить архив."); }
    finally { setDeleting(null); requestRunning.current = false; }
  }

  return <>
    {error ? <div className="banner errorBanner" role="alert">{error}</div> : null}
    {message ? <div className="banner successBanner" role="status">{message}{targetUrl ? <> <a href={`${targetUrl}/admin/login`}>Открыть восстановленную панель</a></> : null}</div> : null}
    <section className="panel sectionPanel adminSectionPanel">
      <span className="pill">Создать полную копию</span>
      <h2 className="adminSectionTitle">Сохранить всё в один архив</h2>
      <p className="helperText">Включены все клиенты, роутеры, оплаты, подписки, обращения, история, аккаунты, настройки, файлы сайта, исходники и конфигурация сервера FOX POINT. Зависимости и сборка восстанавливаются автоматически из сохранённой версии. Архив защищён паролем, включая ключи доступа и пароли панели.</p>
      <form onSubmit={create} className="contentStack">
        <div className="settingsGrid"><label className="fieldStack"><span className="fieldLabel">Пароль архива</span><input className="textInput" name="password" type="password" minLength={12} maxLength={256} autoComplete="new-password" required disabled={busy} /></label>
          <label className="fieldStack"><span className="fieldLabel">Повторите пароль архива</span><input className="textInput" name="repeat" type="password" minLength={12} maxLength={256} autoComplete="new-password" required disabled={busy} /></label></div>
        <p className="helperText">Сохраните пароль отдельно: он понадобится для переноса и восстановления. Скачайте готовый файл на свой компьютер.</p>
        <div className="ctaRow"><button className="primaryButton" type="submit" disabled={busy}>{creating ? "Подготовка…" : "Создать полный бэкап"}</button></div>
      </form>
    </section>
    <section className="panel sectionPanel adminSectionPanel">
      <span className="pill">Сохранённые копии</span><h2 className="adminSectionTitle">Архивы и ход операций</h2>
      <p className="helperText">Скачайте нужные копии на компьютер. Ненужные архивы можно удалить здесь, чтобы освободить место на сервере.</p>
      <div className="contentStack">{snapshot.jobs.length ? snapshot.jobs.map(job => <article key={job.id} className="panel adminRecordCard adminBackupRecord">
        <div className="sectionHeader"><div><strong>{job.kind === "create" ? "Полный бэкап" : job.kind === "upload" ? "Загруженный бэкап" : "Восстановление"}</strong><p className="helperText">{new Date(job.createdAt).toLocaleString("ru-RU")}{job.bytes ? ` · ${size(job.bytes)}` : ""}</p></div><span className="pill">{job.status === "running" ? "Выполняется" : job.status === "ready" ? "Готов" : job.status === "restored" ? "Восстановлен" : "Ошибка"}</span></div>
        <p className="helperText" role="status">{job.step}</p>{job.error ? <p className="errorText">{job.error}</p> : null}
        {job.manifest ? <p className="helperText">Источник: {job.manifest.publicUrl} · Таблиц: {job.manifest.tables.length} · Всего записей: {job.manifest.tables.reduce((sum, table) => sum + table.rows, 0)}</p> : null}
        {job.kind !== "restore" && job.status !== "running" ? <div className="ctaRow">
          {job.status === "ready" ? <><a className="primaryButton" href={`${api}/${job.id}/download`}>Скачать полный архив</a><button className="secondaryButton" type="button" disabled={busy} onClick={() => { setSelected(job.id); document.getElementById("restore-backup")?.scrollIntoView({ behavior: "smooth" }); }}>Выбрать для восстановления</button></> : null}
          <button className="secondaryButton dangerButton" type="button" disabled={busy} onClick={() => setDeleteCandidate(job.id)}>{job.status === "ready" ? "Удалить архив" : "Удалить запись"}</button>
        </div> : null}
        {deleteCandidate === job.id ? <div className="adminBackupRestoreConfirmation" role="group" aria-label="Подтверждение удаления архива">
          <h3>{job.status === "ready" ? "Удалить этот архив?" : "Удалить запись и оставшиеся файлы?"}</h3>
          <p className="helperText">Копия от {new Date(job.createdAt).toLocaleString("ru-RU")}{job.bytes ? ` · ${size(job.bytes)}` : ""} будет безвозвратно удалена с сервера. Файлы, скачанные на ваш компьютер, сохранятся.</p>
          <div className="ctaRow"><button className="secondaryButton dangerButton" type="button" disabled={busy} onClick={() => void deleteBackup(job)}>{deleting === job.id ? "Удаляем…" : "Да, удалить с сервера"}</button><button className="secondaryButton" type="button" disabled={Boolean(deleting)} onClick={() => setDeleteCandidate(null)}>Отмена</button></div>
        </div> : null}
      </article>) : <p className="helperText">Полных архивов пока нет. Создайте первую копию выше.</p>}</div>
    </section>
    <section id="restore-backup" className="panel sectionPanel adminSectionPanel">
      <span className="pill">Восстановить полную панель</span><h2 className="adminSectionTitle">Загрузить сохранённый архив</h2>
      <form onSubmit={upload} className="contentStack"><label className="fieldStack"><span className="fieldLabel">Полный архив .foxbackup</span><input className="textInput" ref={fileInput} type="file" accept=".foxbackup" required disabled={busy} /></label>
        <label className="fieldStack"><span className="fieldLabel">Пароль загружаемого архива</span><input className="textInput" ref={uploadPassword} type="password" minLength={12} maxLength={256} autoComplete="off" required disabled={busy} /></label>
        <div className="ctaRow"><button className="secondaryButton" type="submit" disabled={busy}>{uploading ? `Загрузка ${uploadProgress}% — проверяем архив` : "Загрузить и проверить"}</button></div>
      </form>
      {selected ? <div className="adminBackupRestoreConfirmation">
        <h3>Заменить панель данными из выбранного бэкапа</h3>
        <p className="helperText">Будут восстановлены приложение, вся база данных, файлы и настройки. Перед заменой автоматически сохраняется полная копия текущей панели с паролем выбранного архива. После завершения используйте логин и пароль администратора из восстановленного бэкапа.</p>
        {snapshot.restoreAvailable ? <form onSubmit={restore} className="contentStack">
          <label className="fieldStack"><span className="fieldLabel">Пароль выбранного архива</span><input className="textInput" name="password" type="password" minLength={12} maxLength={256} autoComplete="off" required disabled={busy} /></label>
          <label className="fieldStack"><span className="fieldLabel">Адрес восстановленного сайта</span><input className="textInput" name="targetUrl" type="url" defaultValue={typeof window !== "undefined" ? window.location.origin : ""} placeholder="http://адрес-сервера" required disabled={busy} /></label>
          <label className="fieldStack"><span className="fieldLabel">Для подтверждения введите ВОССТАНОВИТЬ</span><input className="textInput" name="confirmation" pattern="ВОССТАНОВИТЬ" required disabled={busy} /></label>
          <button className="primaryButton" type="submit" disabled={busy}>Восстановить всю панель</button>
        </form> : <p className="helperText">Восстановление всей панели выполняется на VPS. Локально можно создать, скачать, загрузить и проверить полный архив.</p>}
      </div> : null}
    </section>
    <section className="panel sectionPanel adminSectionPanel"><span className="pill">Новый сервер</span><h2 className="adminSectionTitle">Перенести панель целиком</h2>
      <p className="helperText">Скачайте полный архив и установщик восстановления. На новом Ubuntu/Debian VPS загрузите оба файла, затем запустите команду ниже. Установщик восстановит сохранённую версию панели и все данные; повторно импортировать Excel не нужно.</p>
      <div className="ctaRow"><a className="secondaryButton" href="/admin/backups/installer">Скачать установщик для нового VPS</a></div>
      <pre className="adminBackupCommand">sudo bash restore-foxpoint.sh /root/foxpoint-full.foxbackup http://IP-НОВОГО-СЕРВЕРА</pre>
      <p className="helperText">Укажите фактическое имя архива. Установщик запросит пароль архива в терминале. Для переноса на новый домен сначала используйте HTTP, затем подключите HTTPS. Полный бэкап относится ко всей панели FOX POINT, её БД и файлам, а не к образу операционной системы сервера.</p>
    </section>
  </>;
}
