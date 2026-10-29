import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import dns from 'dns';

const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const USER_AGENT = `antigravity/1.107.0 ${os.platform()}/${os.arch()}`;

const accountsPath = path.join(os.homedir(), '.config', 'opencode', 'multi-ai-accounts.json');
const appealLogPath = path.join(os.homedir(), '.config', 'opencode', 'antigravity-appeal-log.json');

const data = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
const appealLog = fs.existsSync(appealLogPath) ? JSON.parse(fs.readFileSync(appealLogPath, 'utf8')) : {};
const accounts = data.accounts.filter(a => a.provider === 'antigravity');

console.log(`\n========================================================================================`);
console.log(`🔍 KIỂM TRA TRẠNG THÁI 26 TÀI KHOẢN ANTIGRAVITY TRÊN GOOGLE API (TRỰC TIẾP)`);
console.log(`========================================================================================\n`);

function customLookup(hostname, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  dns.resolve4(hostname, (err, addrs) => {
    if (err) return cb(err);
    if (opts && opts.all) {
      return cb(null, addrs.map(a => ({ address: a, family: 4 })));
    }
    return cb(null, addrs[0], 4);
  });
}

function httpsPost(urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      lookup: customLookup,
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

async function refreshToken(rt) {
  const postData = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: rt,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
  }).toString();

  const res = await httpsPost(
    'https://oauth2.googleapis.com/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    postData
  );

  if (res.status !== 200) {
    throw new Error(`Refresh HTTP ${res.status}: ${res.text.slice(0, 100)}`);
  }
  return JSON.parse(res.text);
}

async function probeAccount(acc) {
  const email = acc.email;
  const wasDead = acc.subscriptionStatus === 'dead';
  const appealInfo = appealLog[email];

  let refreshed;
  try {
    refreshed = await refreshToken(acc.refreshToken);
  } catch (err) {
    return {
      email,
      wasDead,
      appealInfo,
      status: 'AUTH_REVOKED',
      error: err.message,
    };
  }

  const accessToken = refreshed.access_token;

  try {
    const res = await httpsPost(
      'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
      {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      '{}'
    );

    const status = res.status;
    let bodyJson = {};
    try { bodyJson = JSON.parse(res.text); } catch {}

    if (status === 200) {
      let tier = bodyJson.currentTier?.name || bodyJson.planType || 'Free Tier';
      if (bodyJson.currentTier === 'TIER_PRO' || bodyJson.planType?.includes('PRO')) {
        tier = 'Google AI Pro';
      }

      // Check quota
      let primaryRemaining = '100%';
      try {
        const mRes = await httpsPost(
          'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
          {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          '{}'
        );
        if (mRes.status === 200) {
          const mJson = JSON.parse(mRes.text);
          const models = mJson.models || {};
          const flashModel = models['gemini-2.5-flash'] || models['gemini-1.5-flash'];
          if (flashModel?.quotaInfo?.remainingFraction !== undefined) {
            primaryRemaining = `${Math.round(flashModel.quotaInfo.remainingFraction * 100)}%`;
          }
        }
      } catch {}

      return {
        email,
        wasDead,
        appealInfo,
        status: 'ACTIVE_200',
        tier,
        primaryRemaining,
      };
    }

    const isTos = res.text.includes('TOS_VIOLATION') || bodyJson.error?.message?.includes('TOS_VIOLATION');
    const errMsg = bodyJson.error?.message || res.text.slice(0, 100);

    return {
      email,
      wasDead,
      appealInfo,
      status: isTos ? 'TOS_VIOLATION' : `HTTP_${status}`,
      error: errMsg,
    };
  } catch (err) {
    return {
      email,
      wasDead,
      appealInfo,
      status: 'API_ERROR',
      error: err.message,
    };
  }
}

const results = [];
for (let i = 0; i < accounts.length; i++) {
  const acc = accounts[i];
  process.stdout.write(`[${i + 1}/${accounts.length}] Kiểm tra ${acc.email}... `);
  const r = await probeAccount(acc);
  results.push(r);
  if (r.status === 'ACTIVE_200') {
    if (r.wasDead) {
      console.log(`🎉 ĐÃ ĐƯỢC MỞ LẠI! (200 OK, Gói: ${r.tier})`);
    } else {
      console.log(`✅ 200 OK (${r.tier}, Quota: ${r.primaryRemaining})`);
    }
  } else if (r.status === 'TOS_VIOLATION') {
    console.log(`🔴 403 VẪN BỊ KHÓA (TOS_VIOLATION - Đang chờ duyệt)`);
  } else {
    console.log(`⚠️ ${r.status}: ${r.error?.slice(0, 80)}`);
  }
}

console.log(`\n========================================================================================`);
console.log(`BẢNG TỔNG KẾT TRẠNG THÁI HIỆN TẠI (26 TÀI KHOẢN)`);
console.log(`========================================================================================`);
console.log(`${'Email'.padEnd(34)} | ${'Trạng thái trước'.padEnd(18)} | ${'Trạng thái Google'.padEnd(25)} | ${'Chi tiết / Kháng nghị'.padEnd(30)}`);
console.log(`----------------------------------------------------------------------------------------`);

let activeCount = 0;
let restoredCount = 0;
let stillBannedCount = 0;
let errorCount = 0;

for (const r of results) {
  const prev = r.wasDead ? '🔴 Đã bị khóa' : '🟢 Bình thường';
  let curr = '';
  let detail = '';

  if (r.status === 'ACTIVE_200') {
    if (r.wasDead) {
      curr = '🎉 ĐÃ ĐƯỢC MỞ LẠI!';
      restoredCount++;
    } else {
      curr = '🟢 HOẠT ĐỘNG (200)';
      activeCount++;
    }
    detail = `${r.tier || 'OK'} (${r.primaryRemaining} quota)`;
  } else if (r.status === 'TOS_VIOLATION') {
    curr = '🔴 VẪN ĐANG KHÓA (TOS)';
    stillBannedCount++;
    const appealedDate = r.appealInfo?.lastAppealedAt ? r.appealInfo.lastAppealedAt.slice(0, 16).replace('T', ' ') : 'Chưa gửi';
    detail = `Chờ Google duyệt (Gửi: ${appealedDate})`;
  } else {
    curr = `⚠️ ${r.status}`;
    errorCount++;
    detail = (r.error || '').slice(0, 30);
  }

  console.log(`${r.email.padEnd(34)} | ${prev.padEnd(18)} | ${curr.padEnd(25)} | ${detail.padEnd(30)}`);
}

console.log(`----------------------------------------------------------------------------------------`);
console.log(`📊 TỔNG KẾT THỰC TẾ:`);
console.log(`- Tài khoản bình thường (sẵn sàng dùng): ${activeCount}`);
console.log(`- Tài khoản vừa được Google mở lại:       ${restoredCount}`);
console.log(`- Tài khoản vẫn chờ duyệt sau kháng nghị: ${stillBannedCount}`);
if (errorCount > 0) console.log(`- Lỗi xác thực / Thu hồi quyền:          ${errorCount}`);
console.log(`========================================================================================\n`);

// Update multi-ai-accounts.json if any account was restored
const restoredEmails = results.filter(r => r.status === 'ACTIVE_200' && r.wasDead).map(r => r.email);
if (restoredEmails.length > 0) {
  console.log(`🔄 Cập nhật ${restoredEmails.length} tài khoản vừa được mở lại vào multi-ai-accounts.json...`);
  for (const acc of data.accounts) {
    if (restoredEmails.includes(acc.email)) {
      acc.subscriptionStatus = 'active';
      delete acc.quotaResetAt;
    }
  }
  fs.writeFileSync(accountsPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ Đã cập nhật xong!`);
}
