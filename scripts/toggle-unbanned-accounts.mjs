#!/usr/bin/env node
/**
 * Công cụ quản lý BẬT / TẮT toàn bộ 27 tài khoản Antigravity trong pool.
 *
 * Cách dùng:
 *   node scripts/toggle-unbanned-accounts.mjs                  # Xem trạng thái FULL 27 tài khoản
 *   node scripts/toggle-unbanned-accounts.mjs --enable         # Bật 10 tài khoản vừa phục hồi
 *   node scripts/toggle-unbanned-accounts.mjs --disable        # Tạm tắt 10 tài khoản phục hồi (cho nghỉ)
 *   node scripts/toggle-unbanned-accounts.mjs --enable-all     # Bật toàn bộ 24 tài khoản hợp lệ
 *   node scripts/toggle-unbanned-accounts.mjs --toggle <email> # Bật/tắt 1 tài khoản cụ thể
 */

import fs from "node:fs";

const ACCOUNTS_PATH = "/Users/mac/.config/opencode/multi-ai-accounts.json";

// 10 tài khoản đã từng bị ban và vừa được Google mở lại
const UNBANNED_ACCOUNTS = new Set([
  "agarezgoggi@gmail.com",
  "dakotatendo91@gmail.com",
  "cantistaekta406@gmail.com",
  "shegarviv889@gmail.com",
  "keyshaayyash371@gmail.com",
  "alsosrizaldo879@gmail.com",
  "luisfvalentim92@gmail.com",
  "oanazeid24@gmail.com",
  "sortonnikolai736@gmail.com",
  "saudagarwanly853@gmail.com",
]);

// 3 tài khoản đang bị 403 TOS violation (đang chờ duyệt)
const PENDING_ACCOUNTS = new Set([
  "ndthang280203@gmail.com",
  "ndthang282903@gmail.com",
  "arnfriedstephenson437@gmail.com",
]);

function saveAccounts(data, raw) {
  // Backup file before write
  fs.writeFileSync(ACCOUNTS_PATH + ".bak." + Date.now(), raw, { mode: 0o600 });
  const tempPath = ACCOUNTS_PATH + ".tmp." + Date.now();
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, ACCOUNTS_PATH);
}

const raw = fs.readFileSync(ACCOUNTS_PATH, "utf8");
const data = JSON.parse(raw);
const antiAccounts = (data.accounts || []).filter((a) => a.provider === "antigravity");

const args = process.argv.slice(2);
const command = args[0];

if (command === "--enable" || command === "-e" || command === "--enable-unbanned") {
  let count = 0;
  for (const acc of antiAccounts) {
    if (UNBANNED_ACCOUNTS.has(acc.email)) {
      acc.enabled = true;
      acc.subscriptionStatus = "active";
      acc.note = "Đã bật lại sau thời gian nghỉ dưỡng.";
      count++;
    }
  }
  saveAccounts(data, raw);
  console.log(`\n✅ ĐÃ BẬT LẠI ${count} TÀI KHOẢN PHỤC HỒI VÀO POOL HOẠT ĐỘNG!\n`);
  showTable();
} else if (command === "--disable" || command === "-d" || command === "--disable-unbanned") {
  let count = 0;
  for (const acc of antiAccounts) {
    if (UNBANNED_ACCOUNTS.has(acc.email)) {
      acc.enabled = false;
      acc.note = "Tạm nghỉ sau khi được mở khóa (tránh bị Google quét lại). Bật lại sau vài ngày.";
      count++;
    }
  }
  saveAccounts(data, raw);
  console.log(`\n⏸️  ĐÃ TẠM TẮT ${count} TÀI KHOẢN PHỤC HỒI CHO NGHỈ DƯỠNG!\n`);
  showTable();
} else if (command === "--enable-all") {
  let count = 0;
  for (const acc of antiAccounts) {
    if (!PENDING_ACCOUNTS.has(acc.email)) {
      acc.enabled = true;
      acc.subscriptionStatus = "active";
      count++;
    }
  }
  saveAccounts(data, raw);
  console.log(`\n✅ ĐÃ BẬT TẤT CẢ ${count} TÀI KHOẢN HỢP LỆ VÀO POOL!\n`);
  showTable();
} else if (command === "--toggle" || command === "-t") {
  const targetEmail = args[1]?.toLowerCase().trim();
  if (!targetEmail) {
    console.error("❌ Vui lòng truyền email cần bật/tắt: node scripts/toggle-unbanned-accounts.mjs --toggle <email>");
    process.exit(1);
  }
  const target = antiAccounts.find((a) => a.email.toLowerCase() === targetEmail);
  if (!target) {
    console.error(`❌ Không tìm thấy tài khoản có email: ${targetEmail}`);
    process.exit(1);
  }
  target.enabled = !target.enabled;
  saveAccounts(data, raw);
  const statusStr = target.enabled ? "🟢 BẬT" : "⏸️  TẮT";
  console.log(`\n🔄 ĐÃ CHUYỂN TRẠNG THÁI ${targetEmail} THÀNH: ${statusStr}\n`);
  showTable();
} else {
  showTable();
}

function showTable() {
  const cleanList = [];
  const unbannedList = [];
  const pendingList = [];

  for (const acc of antiAccounts) {
    if (PENDING_ACCOUNTS.has(acc.email)) {
      pendingList.push(acc);
    } else if (UNBANNED_ACCOUNTS.has(acc.email)) {
      unbannedList.push(acc);
    } else {
      cleanList.push(acc);
    }
  }

  const printRow = (idx, acc, typeDesc) => {
    const emailCol = acc.email.padEnd(35);
    const statusCol = acc.enabled ? "🟢 BẬT (Đang chạy)" : "⏸️  TẮT (Nghỉ/Khóa)";
    console.log(`| ${(idx + "").padStart(2)} | ${emailCol} | ${statusCol} | ${typeDesc} |`);
  };

  console.log("======================================================================================================");
  console.log(`🛡️  DANH SÁCH TOÀN BỘ ${antiAccounts.length} TÀI KHOẢN ANTIGRAVITY TRONG POOL`);
  console.log("======================================================================================================");
  console.log("| STT| Email                               | Trạng thái pool    | Phân loại                      |");
  console.log("|----+-------------------------------------+--------------------+--------------------------------|");

  console.log("|    | 🟢 NHÓM 1: TÀI KHOẢN CHÍNH (SẠCH)   |                    |                                |");
  let i = 1;
  for (const acc of cleanList) {
    printRow(i++, acc, "Tài khoản sạch (hoạt động liên tục)");
  }

  console.log("|----+-------------------------------------+--------------------+--------------------------------|");
  console.log("|    | 🔄 NHÓM 2: VỪA PHỤC HỒI (UNBANNED)  |                    |                                |");
  for (const acc of unbannedList) {
    printRow(i++, acc, "Vừa được Google mở lại (200 OK) ");
  }

  console.log("|----+-------------------------------------+--------------------+--------------------------------|");
  console.log("|    | 🔴 NHÓM 3: ĐANG BỊ KHÓA (CHỜ DUYỆT) |                    |                                |");
  for (const acc of pendingList) {
    printRow(i++, acc, "403 TOS (Đang chờ Google duyệt) ");
  }

  const activeCount = antiAccounts.filter((a) => a.enabled).length;
  const disabledCount = antiAccounts.filter((a) => !a.enabled && !PENDING_ACCOUNTS.has(a.email)).length;
  const lockedCount = pendingList.length;

  console.log("======================================================================================================");
  console.log(`📊 TỔNG KẾT:`);
  console.log(`   - Tổng tài khoản:            ${antiAccounts.length}`);
  console.log(`   - Đang BẬT trong pool:       🟢 ${activeCount}`);
  console.log(`   - Đang TẮT (nghỉ dưỡng):     ⏸️  ${disabledCount}`);
  console.log(`   - Đang bị khóa (403 TOS):    🔴 ${lockedCount}`);
  console.log("------------------------------------------------------------------------------------------------------");
  console.log("👉 Các lệnh hữu ích:");
  console.log("   • Xem danh sách:             node scripts/toggle-unbanned-accounts.mjs");
  console.log("   • Bật 10 acc phục hồi:       node scripts/toggle-unbanned-accounts.mjs --enable");
  console.log("   • Tắt 10 acc phục hồi:       node scripts/toggle-unbanned-accounts.mjs --disable");
  console.log("   • Bật tất cả 24 acc sạch:    node scripts/toggle-unbanned-accounts.mjs --enable-all");
  console.log("   • Bật/Tắt 1 acc riêng lẻ:    node scripts/toggle-unbanned-accounts.mjs --toggle <email>");
  console.log("======================================================================================================\n");
}
