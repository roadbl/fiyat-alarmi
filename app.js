const API_BASE = (window.API_BASE || "").replace(/\/$/, "");
const STORAGE_KEY = "fiyat_alarm_simple_v1";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function savedTrackers() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveTrackers(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value, currency = "TRY") {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

function dateText(value) {
  if (!value) return "Henüz kontrol edilmedi";
  return new Date(value).toLocaleString("tr-TR");
}

async function api(path, options = {}) {
  const response = await fetch(API_BASE + path, options);
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  }
  return data;
}

function switchTab(name) {
  $$(".tab").forEach(el => el.classList.remove("active"));
  $$(".nav-btn").forEach(el => el.classList.remove("active"));

  $("#tab-" + name)?.classList.add("active");
  $(`.nav-btn[data-tab="${name}"]`)?.classList.add("active");

  if (name === "trackers") refreshTrackers();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$$("[data-tab]").forEach(button => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

function headersFor(item) {
  return { "X-Manage-Token": item.token };
}

async function getTracker(item) {
  return api(`/api/trackers/${item.id}`, {
    headers: headersFor(item)
  });
}

function trackerCard(t) {
  const reached = t.last_price !== null &&
                  t.last_price !== undefined &&
                  t.last_price <= t.target_price;

  return `
    <article class="tracker-card" data-id="${escapeHtml(t.id)}">
      <div class="tracker-top">
        <div>
          <h3 class="tracker-title">${escapeHtml(t.product_name || t.query)}</h3>
          <div class="source">${escapeHtml(t.last_source || "Kaynak aranıyor…")}</div>
        </div>
        <div class="status ${reached ? "good" : "wait"}">
          ${reached ? "● Hedefe ulaştı" : (t.active ? "● Takipte" : "⏸ Durduruldu")}
        </div>
      </div>

      <div class="metrics">
        <div class="metric">
          <span>Güncel</span>
          <strong>${money(t.last_price, t.currency)}</strong>
        </div>
        <div class="metric">
          <span>Hedef</span>
          <strong>${money(t.target_price, t.currency)}</strong>
        </div>
        <div class="metric">
          <span>Güven</span>
          <strong>${t.last_confidence == null ? "—" : "%" + Math.round(t.last_confidence * 100)}</strong>
        </div>
      </div>

      ${t.last_error ? `<div class="tracker-error">${escapeHtml(t.last_error)}</div>` : ""}

      <div class="tracker-actions">
        ${t.last_url ? `<a class="store-link" target="_blank" rel="noopener" href="${escapeHtml(t.last_url)}">Mağazayı aç ↗</a>` : `<span class="store-link"></span>`}
        <button class="small-btn check-btn">Şimdi kontrol</button>
        <button class="small-btn toggle-btn">${t.active ? "Durdur" : "Başlat"}</button>
        <button class="small-btn danger delete-btn">Sil</button>
      </div>

      <div class="source">Son kontrol: ${escapeHtml(dateText(t.last_checked_at))}</div>
    </article>
  `;
}

async function refreshTrackers() {
  const list = $("#trackerList");
  const saved = savedTrackers();

  if (!saved.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span>🔔</span>
        <h3>Henüz fiyat alarmın yok</h3>
        <p>Bir ürün eklediğinde burada görünecek.</p>
        <button class="secondary" data-go-create>İlk alarmı oluştur</button>
      </div>`;
    $("[data-go-create]")?.addEventListener("click", () => switchTab("create"));
    return;
  }

  list.innerHTML = `<div class="empty-state"><p>Alarmların yükleniyor…</p></div>`;

  const cards = [];
  const stillValid = [];

  for (const item of saved) {
    try {
      const tracker = await getTracker(item);
      cards.push(trackerCard(tracker));
      stillValid.push(item);
    } catch (err) {
      if (!String(err.message).includes("404")) stillValid.push(item);
    }
  }

  saveTrackers(stillValid);
  list.innerHTML = cards.length
    ? cards.join("")
    : `<div class="empty-state"><h3>Alarm bulunamadı</h3></div>`;

  bindTrackerActions();
}

function findSaved(id) {
  return savedTrackers().find(x => x.id === id);
}

function bindTrackerActions() {
  $$(".tracker-card").forEach(card => {
    const id = card.dataset.id;
    const item = findSaved(id);
    if (!item) return;

    card.querySelector(".check-btn")?.addEventListener("click", async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Kontrol ediliyor…";
      try {
        await api(`/api/trackers/${id}/check`, {
          method: "POST",
          headers: headersFor(item)
        });
      } catch (err) {
        alert(err.message);
      }
      await refreshTrackers();
    });

    card.querySelector(".toggle-btn")?.addEventListener("click", async () => {
      const tracker = await getTracker(item);
      await api(`/api/trackers/${id}/active`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...headersFor(item)
        },
        body: JSON.stringify({ active: !tracker.active })
      });
      await refreshTrackers();
    });

    card.querySelector(".delete-btn")?.addEventListener("click", async () => {
      if (!confirm("Bu fiyat alarmı silinsin mi?")) return;

      await api(`/api/trackers/${id}`, {
        method: "DELETE",
        headers: headersFor(item)
      });

      saveTrackers(savedTrackers().filter(x => x.id !== id));
      await refreshTrackers();
    });
  });
}

$("#alarmForm").addEventListener("submit", async e => {
  e.preventDefault();

  const message = $("#formMessage");
  const button = $("#submitBtn");

  message.textContent = "";
  message.className = "form-message";
  button.disabled = true;
  button.innerHTML = "Oluşturuluyor…";

  const payload = {
    query: $("#query").value.trim(),
    target_price: Number($("#targetPrice").value),
    email: $("#email").value.trim(),
    currency: "TRY"
  };

  try {
    const created = await api("/api/trackers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const items = savedTrackers();
    items.unshift({
      id: created.id,
      token: created.manage_token
    });
    saveTrackers(items);

    message.textContent = "✓ Alarm oluşturuldu. İlk fiyat kontrolü başladı.";
    message.classList.add("ok");

    $("#query").value = "";
    $("#targetPrice").value = "";

    setTimeout(() => switchTab("trackers"), 900);
  } catch (err) {
    message.textContent = "Hata: " + err.message;
    message.classList.add("error");
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>🔔</span> Alarm Oluştur";
  }
});

$("#refreshBtn").addEventListener("click", refreshTrackers);
