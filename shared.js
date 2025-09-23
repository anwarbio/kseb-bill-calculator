/* ======================================================
   shared.js
   🔹 All helper functions for KSEB Prosumer/Consumer Calculator
   ====================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // PDF Download Handler
  const downloadBtn = document.getElementById('downloadFullPDF');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      // --- your PDF generation, save, and download code here ---
      const element = document.getElementById('pdfContent');
      if (!element) return;

      const name = document.getElementById("consumerName")?.value.trim() || "Prosumer";
      const month = document.getElementById("billMonth")?.options[
        document.getElementById("billMonth")?.selectedIndex
      ]?.text || "Month";
      const year = document.getElementById("billYear")?.value || new Date().getFullYear();
      const fileName = `${year}_${month}_Bill_${name}.pdf`;

      const opt = {
        margin: 0.3,
        filename: fileName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, scrollY: 0, useCORS: true },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], before: '.pdf-page-break', avoid: '.avoid-page-break' }
      };

      const pdf = await html2pdf().set(opt).from(element).toPdf().get('pdf');
      const blob = pdf.output('blob');

      const billData = {
        ...lastCalculation,
        filename: fileName,
        date: `${month}-${year}`,
        consumerNo: name,
        billType: document.getElementById("prosumerMode")?.checked ? "Prosumer" : "Consumer"
      };

      try {
        await savePdfToDB(fileName, blob, billData);
        loadHistoryPage();
      } catch (err) {
        console.error("❌ Error saving to DB:", err);
      }

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // Bulk Delete Selected Handler
  const deleteBtn = document.getElementById('deleteSelected');
  if (deleteBtn) deleteBtn.addEventListener('click', bulkDeleteSelected);
});


/* ------------------------------------------------------
   1. Centralized IndexedDB Initialization (version 2)
------------------------------------------------------ */
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ksebDB", 2);

    request.onupgradeneeded = function(event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("pdfs")) {
        db.createObjectStore("pdfs", { keyPath: "filename" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}




/* ------------------------------------------------------
   3. Save PDF to IndexedDB (Base64)
------------------------------------------------------ */
async function savePdfToDB(filename, pdfBlob, billMeta = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = async function () {
      const base64Data = reader.result;

      try {
        const db = await openDB();
        if (!db.objectStoreNames.contains("pdfs")) {
          reject("❌ Object store 'pdfs' not found!");
          return;
        }

        const tx = db.transaction("pdfs", "readwrite");
        const store = tx.objectStore("pdfs");

       // ✅ Parse metadata from filename (2025_Sep_Bill_Prosumer.pdf)
let billYear, billMonth, consumerNo;
try {
  const parts = filename.replace(".pdf", "").split("_");
  billYear = parts[0];         // e.g. 2025
  billMonth = parts[1];        // e.g. Sep
  consumerNo = parts.slice(3).join("_"); // e.g. Prosumer (or longer name)
} catch (e) {
  console.warn("⚠️ Could not parse filename:", filename);
}

function safeNumber(value) {
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;   // ✅ keep undefined if not provided
}

const data = {
  filename,
  pdfBase64: base64Data,
  billMonth,
  billYear,
  consumerNo,

  // Billing numbers
  Pros_Bill_Amt: safeNumber(lastCalculation.Pros_Bill_Amt),
  Cons_Bill_Amt: safeNumber(lastCalculation.Cons_Bill_Amt),
  fixedCharge: safeNumber(lastCalculation.fixedCharge),
  billedUnits: safeNumber(lastCalculation.billedUnits),

  // Units
  importUnits: safeNumber(lastCalculation.importUnits),
  exportUnits: safeNumber(lastCalculation.exportUnits),
  solarGenerated: safeNumber(lastCalculation.solarGenerated),
  bankedUnits: safeNumber(lastCalculation.BankedUnits),   // ✅ added

  // Savings & balances
  LatestBankBalance: safeNumber(lastCalculation.LatestBankBalance),
  savingsSolar: safeNumber(lastCalculation.savingsSolar),
  savingsWheeling: safeNumber(lastCalculation.savingsWheeling),
  totalSavings: safeNumber(lastCalculation.totalSavings),
  wheelingAdjustedUnits: safeNumber(lastCalculation.wheelingAdjustedUnits),
  wheelingEnergyLost: safeNumber(lastCalculation.wheelingEnergyLost),

  // Link to meter entry
  meterEntryId: lastCalculation.meterEntryId || null,

  // Unified date label
  date: `${billMonth}-${billYear}`
};

        const putRequest = store.put(data);

        putRequest.onsuccess = async () => {
          console.log("✅ PDF saved:", filename);

          // 🔗 If linked to meter diary, update meter entry with final filename

if (lastCalculation?.meterEntryId) {
  try {
    console.log("🔗 Updating meter entry:", lastCalculation.meterEntryId, "→", filename);
    await updateMeterEntryWithFilename(lastCalculation.meterEntryId, filename);
    console.log("✅ Linked meter entry to PDF:", lastCalculation.meterEntryId);
  } catch (err) {
    console.error("❌ Failed to link meter entry:", err);
  }
}

        };

        putRequest.onerror = e => reject("❌ DB put error: " + e.target.errorCode);

        tx.oncomplete = () => resolve();
        tx.onerror = e => reject("❌ DB transaction error: " + e.target.errorCode);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = e => reject(e);
    reader.readAsDataURL(pdfBlob);
  });
}



/* ------------------------------------------------------
   5. View PDF
------------------------------------------------------ */
async function viewPDF(filename) {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains("pdfs")) throw "Object store 'pdfs' not found";

    const tx = db.transaction("pdfs", "readonly");
    const store = tx.objectStore("pdfs");
    const getReq = store.get(filename);

    getReq.onsuccess = async function(event) {
      const data = event.target.result;
      if (!data || !data.pdfBase64) return alert("⚠️ PDF not found in DB");

      const res = await fetch(data.pdfBase64);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    };

    getReq.onerror = e => console.error("❌ Failed to get PDF from DB:", e.target.errorCode);
  } catch (err) {
    console.error("❌ Error viewing PDF:", err);
  }
}


/* ------------------------------------------------------
   6. Download PDF
------------------------------------------------------ */
async function downloadBill(filename) {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains("pdfs")) throw "Object store 'pdfs' not found";

    const tx = db.transaction("pdfs", "readonly");
    const store = tx.objectStore("pdfs");
    const getReq = store.get(filename);

    getReq.onsuccess = async function(event) {
      const data = event.target.result;
      if (!data || !data.pdfBase64) return alert("⚠️ PDF not found in DB");

      const res = await fetch(data.pdfBase64);
      const blob = await res.blob();

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    };

    getReq.onerror = e => console.error("❌ Failed to get PDF from DB:", e.target.errorCode);
  } catch (err) {
    console.error("❌ Error downloading PDF:", err);
  }
}


/* ------------------------------------------------------
   7. Delete PDF (single)
------------------------------------------------------ */
async function deletePDF(filename) {
  if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains("pdfs")) throw "Object store 'pdfs' not found";

    const tx = db.transaction("pdfs", "readwrite");
    const store = tx.objectStore("pdfs");

    const delReq = store.delete(filename);

    delReq.onsuccess = async () => {
      console.log("🗑 Deleted history entry:", filename);

      // 🔗 also delete linked entries from meterDB
      try {
        const count = await deleteMeterEntriesByFilename(filename);
        console.log(`🗑 Deleted ${count} meterDB entries linked to ${filename}`);
      } catch (err) {
        console.error("❌ Failed to delete linked meterDB entries:", err);
      }
    };

    // ✅ refresh only after tx completes
   tx.oncomplete = async () => {
  console.log("✅ Transaction complete, refreshing history table…");
  await loadHistoryPage();   // ✅ now waited
  };


    tx.onerror = e => alert("❌ Delete failed: " + e.target.errorCode);
  } catch (err) {
    console.error("❌ Error deleting PDF:", err);
  }
}



/* ------------------------------------------------------
   Export History as CSV (with updated schema + new fields)
------------------------------------------------------ */
async function exportHistoryAsCSV() {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains("pdfs")) throw "Object store 'pdfs' not found";

    const tx = db.transaction("pdfs", "readonly");
    const store = tx.objectStore("pdfs");

    store.getAll().onsuccess = function (event) {
      const results = event.target.result;
      if (!results || results.length === 0) return alert("⚠️ No saved history to export.");

      // ✅ Corrected header order
      const header = [
        "Filename",
        "Date",
        "ID/Name",
        "TotalProsumerBill",
        "TotalConsumerBill",
        "SavingsSolar",
        "SavingsWheeling",
        "TotalSavings",
        "PreviousBankBalance",
        "ImportUnits",
        "ExportUnits",
        "SolarGenerated",
        "BankedUnits",
        "BilledUnits",
        "FixedCharge",
        "WheelingAdjustedUnits",
        "WheelingEnergyLost"
      ];

      let csv = header.join(",") + "\n";

      results.forEach(item => {
        const row = [
          item.filename || "",
          item.date || "",
          item.consumerNo || "",              // renamed as ID/Name
          safeNumber(item.Pros_Bill_Amt),     // TotalProsumerBill
          safeNumber(item.Cons_Bill_Amt),     // TotalConsumerBill
          safeNumber(item.savingsSolar),
          safeNumber(item.savingsWheeling),
          safeNumber(item.totalSavings),
          safeNumber(item.PreviousBankBalance), // Previous Bank Balance
          safeNumber(item.importUnits),
          safeNumber(item.exportUnits),
          safeNumber(item.solarGenerated),
          safeNumber(item.LatestBankBalance),   // Banked Units
          safeNumber(item.billedUnits),
          safeNumber(item.fixedCharge),
          safeNumber(item.wheelingAdjustedUnits),
          safeNumber(item.wheelingEnergyLost)
        ];
        csv += row.map(csvEscape).join(",") + "\n";
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kseb_bill_history.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    };
  } catch (err) {
    console.error("❌ Error exporting CSV:", err);
  }
}

/* === Helpers === */
function safeNumber(val) {
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
}

function csvEscape(val) {
  if (val == null) return "";
  const str = String(val);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}


/* ------------------------------------------------------
   9. Helper functions for CSV
------------------------------------------------------ */
function safeNumber(v) {
  if (v === undefined || v === null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : (String(v).replace(/\r?\n|\r/g, " "));
}
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[,"\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function formatDateForCSV(dateStr) {
  if (!dateStr) return "";
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return d.toISOString().split("T")[0];
  }
  return dateStr;
}


/* ------------------------------------------------------
   10. Bulk Delete Selected
------------------------------------------------------ */

// === Helper: Get Selected Filenames ===
function getSelectedFilenames() {
  return Array.from(document.querySelectorAll(".history-select:checked"))
    .map(cb => cb.dataset.filename);
}

// === Bulk Delete ===
async function bulkDeleteSelected() {
  const selected = getSelectedFilenames();
  if (!selected.length) return alert("⚠️ No rows selected for deletion.");
  if (!confirm(`Are you sure you want to delete ${selected.length} selected bill(s)?`)) return;

  try {
    const db = await openDB();
    const tx = db.transaction("pdfs", "readwrite");
    const store = tx.objectStore("pdfs");

    // queue all deletes
    selected.forEach(fn => store.delete(fn));

    tx.oncomplete = async () => {
      // cleanup linked meter entries in parallel
      await Promise.all(selected.map(fn => deleteMeterEntriesByFilename(fn)));
      console.log(`✅ Deleted ${selected.length} history items + linked meter entries`);

      // ✅ refresh after transaction + meter cleanup
      await loadHistoryPage();
    };

    tx.onerror = e => {
      console.error("❌ Error during bulk delete:", e.target.errorCode);
      alert("❌ Bulk delete failed: " + e.target.errorCode);
    };
  } catch (err) {
    console.error("❌ bulkDeleteSelected error:", err);
    alert("❌ Error deleting selected items");
  }
}


/* ------------------------------------------------------
   11. Attach Delete button safely
------------------------------------------------------ */
const deleteBtn = document.getElementById('deleteSelected');
if (deleteBtn) {
  deleteBtn.addEventListener('click', bulkDeleteSelected);
}


/* ------------------------------------------------------
   12. Auto load history on page load
------------------------------------------------------ */
window.addEventListener('load', () => {
  if (document.getElementById("historyTable")) {
    loadHistoryPage();
  }
});


// Wrapper function to load history page
function loadHistoryMain() {
  loadHistoryPage();  // call the new function
}


// ===== Load History Page =====
async function loadHistoryPage() {
  const db = await openDB();
  const tx = db.transaction("pdfs", "readonly");
  const store = tx.objectStore("pdfs");

  const bills = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // ✅ Always clear table
  const historyTableBody = document.querySelector("#historyTable tbody");
  if (!historyTableBody) {
    console.log("ℹ️ Skipping loadHistoryPage — no historyTable found on this page.");
    return;
  }
  historyTableBody.innerHTML = "";

  if (!bills || bills.length === 0) {
    console.log("ℹ️ No bills found.");
    return; // table stays empty
  }

  // ✅ sort by year & month before display
  bills.sort((a, b) => {
    const ymA = new Date(`${a.billMonth || "Jan"} 1, ${a.billYear || "1900"}`);
    const ymB = new Date(`${b.billMonth || "Jan"} 1, ${b.billYear || "1900"}`);
    return ymB - ymA;
  });

  window.billHistory = bills;

  bills.forEach(bill => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><a href="#" onclick="viewPDF('${bill.filename}')">${bill.date}</a></td>
      <td>${bill.consumerNo}</td>
      <td>₹${parseFloat(bill.Pros_Bill_Amt || 0).toFixed(2)}</td>
      <td>₹${parseFloat(bill.totalSavings || 0).toFixed(2)}</td>  
      <td><input type="checkbox" class="history-select" data-filename="${bill.filename}"></td>
    `;
    historyTableBody.appendChild(row);
  });

  populateDateSelectors();
  updateSummaryTotals(bills);
}





/* ======================================================
   meterDB.js (or append into shared.js)
   For Meter Diary & Autofill
   ====================================================== */
/* ------------------------------------------------------
   MeterDB Helpers
------------------------------------------------------ */
// open meterDB with indexes (shared.js)
async function openMeterDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("meterDB", 3); // bump version to wipe old schema
    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      // remove old store if it exists
      if (db.objectStoreNames.contains("meterReadings")) {
        db.deleteObjectStore("meterReadings");
      }

      // ✅ Use entryId as keyPath (stable UUID from buildMeterSnapshot)
      const store = db.createObjectStore("meterReadings", { keyPath: "entryId" });

      // secondary indexes for search
      store.createIndex("byFilename", "filename", { unique: false });
      store.createIndex("byConsumer", "consumerName", { unique: false });
      store.createIndex("bySavedAt", "savedAt", { unique: false });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}



async function saveMeterReading(entry) {
  try {
    const db = await openMeterDB();
    const normalizeName = (name) => name && name.trim() ? name.trim() : "Prosumer";
    entry.consumerName = normalizeName(entry.consumerName);

    // ✅ Step 1: Find duplicates first
    const readTx = db.transaction("meterReadings", "readonly");
    const readStore = readTx.objectStore("meterReadings");
    const all = await new Promise((resolve, reject) => {
      const r = readStore.getAll();
      r.onsuccess = (e) => resolve(e.target.result || []);
      r.onerror = (e) => reject(e.target.error);
    });

    const duplicates = all.filter(d =>
      d.billMonth === entry.billMonth &&
      d.billYear === entry.billYear &&
      normalizeName(d.consumerName) === entry.consumerName &&
      d.entryId !== entry.entryId
    );

    // ✅ Step 2: Delete duplicates in a write transaction
    if (duplicates.length > 0) {
      const delTx = db.transaction("meterReadings", "readwrite");
      const delStore = delTx.objectStore("meterReadings");
      for (const d of duplicates) {
        delStore.delete(d.entryId);
        console.log("🗑️ Deleted old meter entry:", d.entryId, d.billMonth, d.billYear, d.consumerName);
      }
      await new Promise((resolve, reject) => {
        delTx.oncomplete = () => resolve();
        delTx.onerror = (e) => reject(e.target.error);
      });
    }

    // ✅ Step 3: Save new entry
    const saveTx = db.transaction("meterReadings", "readwrite");
    const saveStore = saveTx.objectStore("meterReadings");
    const req = saveStore.put(entry);

    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        console.log("✅ Saved meter reading:", entry);
        resolve(entry);
      };
      req.onerror = (e) => {
        console.error("❌ saveMeterReading error:", e.target.error);
        reject(e.target.error);
      };
    });

  } catch (err) {
    console.error("❌ saveMeterReading outer error:", err);
    throw err;
  }
}



/**
 * Update a provisional meter entry with its final filename & metadata
 * @param {string} provisionalId - entryId assigned during buildMeterSnapshot
 * @param {string} finalFilename - the actual PDF filename
 * @param {string} billMonth
 * @param {string} billYear
 * @param {string} consumerNo
 */

async function updateMeterEntryWithFilename(entryId, filename) {
  const db = await openMeterDB();
  const tx = db.transaction("meterReadings", "readwrite");
  const store = tx.objectStore("meterReadings");
  const req = store.get(entryId);

  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const entry = req.result;
      if (!entry) {
        reject("⚠️ No meter entry found for ID: " + entryId);
        return;
      }

      // ✅ Parse metadata from filename: "2025_Oct_Bill_Prosumer.pdf"
      let billYear, billMonth, consumerNo;
      try {
        const parts = filename.replace(".pdf", "").split("_");
        billYear = parts[0];       // 2025
        billMonth = parts[1];      // Oct
        consumerNo = parts.slice(3).join("_"); // Prosumer (or longer name)
      } catch (e) {
        console.warn("⚠️ Could not parse filename for metadata", filename);
      }

      // ✅ Patch entry
      entry.filename = filename;
      entry.billYear = billYear || entry.billYear;
      entry.billMonth = billMonth || entry.billMonth;
      entry.consumerName = consumerNo || entry.consumerName;
      entry.isFinal = true;   // ✅ mark entry as finalized

      store.put(entry).onsuccess = () => resolve(entry);
    };
    req.onerror = () => reject(req.error);
  });
}



async function deleteMeterEntriesByFilename(filename) {
  const db = await openMeterDB();
  const tx = db.transaction("meterReadings", "readwrite");
  const store = tx.objectStore("meterReadings");
  const idx = store.index("byFilename");

  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.only(filename);
    const cursorReq = idx.openCursor(range);
    let deleted = 0;
    cursorReq.onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur) {
        tx.oncomplete = () => resolve(deleted);
        return;
      }
      store.delete(cur.primaryKey);
      deleted++;
      cur.continue();
    };
    cursorReq.onerror = (err) => reject(err);
  });
}


async function getLatestMeterEntry() {
  const db = await openMeterDB();
  const tx = db.transaction("meterReadings", "readonly");
  const store = tx.objectStore("meterReadings");
  const index = store.index("bySavedAt");

  return new Promise((resolve, reject) => {
    const req = index.openCursor(null, "prev"); // "prev" = latest first
    req.onsuccess = e => {
      const cursor = e.target.result;
      resolve(cursor ? cursor.value : null);
    };
    req.onerror = () => reject(req.error);
  });
}


/* --------------------------------------------------
   Autofill meter readings (safe assignments)
   -------------------------------------------------- */
async function autofillMeterReadings() {
  try {
    const db = await openMeterDB();
    const tx = db.transaction("meterReadings", "readonly");
    const store = tx.objectStore("meterReadings");

    // ✅ Get the latest by savedAt
    const index = store.index("bySavedAt");
    const req = index.openCursor(null, "prev"); // newest first

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        console.log("ℹ️ No meter readings found for autofill");
        return;
      }

      const latest = cursor.value;
      console.log("🔍 Latest meter entry:", latest);

      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined && val !== "") {
          el.value = val;
          console.log(`✍️ Autofilled ${id} = ${val}`);
        }
      };

      // ✅ Bank always fills
      set("Bank", latest.LatestBankBalance);

      // ✅ Non-TOD Mode
      if ((latest.TODAvailability || "no").toLowerCase() === "no") {
        set("importUnits_prev", latest.nonTOD?.importCurr);
        set("exportUnits_prev", latest.nonTOD?.exportCurr);
        set("generation_prev", latest.nonTOD?.genCurr);
      } else {
        // ✅ TOD Mode
        // Import
        set("IM_TodNL_prev", latest.tod?.IM_TodNL_curr);
        set("IM_TodOP_prev", latest.tod?.IM_TodOP_curr);
        set("IM_TodPK_prev", latest.tod?.IM_TodPK_curr);

        // Export
        set("EX_TodNL_prev", latest.tod?.EX_TodNL_curr);
        set("EX_TodOP_prev", latest.tod?.EX_TodOP_curr);
        set("EX_TodPK_prev", latest.tod?.EX_TodPK_curr);

        // Generation
        set("GEN_NL_prev", latest.tod?.GEN_NL_curr);
        set("GEN_OP_prev", latest.tod?.GEN_OP_curr);
        set("GEN_PK_prev", latest.tod?.GEN_PK_curr);
      }

      // ✅ NEW: Restore custom wheeling site names
      if (latest.wheelingSites && latest.wheelingSites.length > 0) {
        latest.wheelingSites.forEach(site => {
          const el = document.getElementById(`wheelingName-${site.siteIndex}`);
          if (el) {
            el.value = site.customName || `Site ${site.siteIndex}`;
            console.log(`✍️ Autofilled wheelingName-${site.siteIndex} = ${el.value}`);
          }
        });
      }

      // ✅ Save for generateWheelingSites()
      window.latestAutofill = latest;
    };

    req.onerror = e => {
      console.error("❌ Error reading latest meter entry:", e);
    };
  } catch (err) {
    console.error("❌ autofillMeterReadings error:", err);
  }
}


/* ------------------------------------------------------
   Delete meter entry (by filename key)
------------------------------------------------------ */
async function deleteMeterEntry(filename) {
  try {
    const db = await openMeterDB();
    const tx = db.transaction("meterReadings", "readwrite");
    tx.objectStore("meterReadings").delete(filename);
    console.log(`🗑 Deleted meter entry for ${filename}`);
    return tx.complete;
  } catch (err) {
    console.error("❌ deleteMeterEntry error:", err);
  }
}


/* ==============================
   Backup / Restore Helpers
============================== */
async function exportAllDBData() {
  const dbs = ["ksebDB", "meterDB"]; // exact DB names
  const backup = {};

  for (const dbName of dbs) {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });

    backup[dbName] = [];

    // loop over object stores
    for (let i = 0; i < db.objectStoreNames.length; i++) {
      const storeName = db.objectStoreNames[i];
      const data = await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = e => resolve(e.target.result || []);
        req.onerror = e => reject(e.target.error);
      });

      backup[dbName].push({
        storeName,
        data
      });
    }

    db.close();
  }

  return backup;
}

async function importAllDBData(backup) {
  const allowedDBs = ["ksebDB", "meterDB"];

  for (const dbName of Object.keys(backup)) {
    if (!allowedDBs.includes(dbName)) {
      console.warn(`⚠️ Skipping unknown DB: ${dbName}`);
      continue;
    }

    const stores = backup[dbName];
    if (!Array.isArray(stores)) {
      console.warn(`⚠️ No stores found for ${dbName}`);
      continue;
    }

    console.log(`🔄 Restoring DB: ${dbName} with ${stores.length} stores`);

    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });

    for (const store of stores) {
      const storeName = store.storeName;
      const dataArray = store.data || [];

      if (!db.objectStoreNames.contains(storeName)) {
        console.warn(`⚠️ Store ${storeName} not found in ${dbName}, skipping`);
        continue;
      }

      console.log(`📥 Inserting ${dataArray.length} records into ${dbName}.${storeName}`);

      const tx = db.transaction(storeName, "readwrite");
      const objectStore = tx.objectStore(storeName);

      for (const record of dataArray) {
        try {
          objectStore.put(record);
        } catch (err) {
          console.error(`❌ Failed to insert into ${dbName}.${storeName}`, err, record);
        }
      }

      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    }

    db.close();
  }

  alert("✅ Restore finished. Check console logs for details.");
}

async function cleanupOrphanedMeterEntries() {
  const db = await openMeterDB();
  const tx = db.transaction("meterReadings", "readwrite");
  const store = tx.objectStore("meterReadings");
  const req = store.getAll();

  req.onsuccess = () => {
    req.result.forEach(entry => {
      if (!entry.isFinal) {
        console.log("🗑 Removing orphaned entry:", entry.entryId);
        store.delete(entry.entryId);
      }
    });
  };
}


