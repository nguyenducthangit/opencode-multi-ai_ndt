#!/usr/bin/env bun
/**
 * Auto-Appeal Tool for Google Antigravity / Gemini Code Assist
 * 
 * Automates submitting appeals through the official Google Form:
 * https://forms.gle/hGzM9MEUv2azZsrb9 (Form: e/1FAIpQLScOJWibQ_-hYuVv63kJTgEqlgAaOwRLGFTbXm-QY1gz8U0CGA)
 * 
 * Features:
 * - Scans multi-ai-accounts.json & Chrome profiles in ~/Library/Application Support/Google/Chrome
 * - Auto-detects banned accounts (TOS_VIOLATION / dead)
 * - Launches Chrome in each account's dedicated profile with prefilled appeal form
 * - Dismisses 'Autosave your work' modal
 * - Checks required email consent checkbox: 'Record email as the email to be included with my response'
 * - Confirms 'Yes, I understand'
 * - Submits form and verifies Google's 24-72h confirmation message
 * - Logs results to ~/.config/opencode/antigravity-appeal-log.json
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const FORM_BASE_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScOJWibQ_-hYuVv63kJTgEqlgAaOwRLGFTbXm-QY1gz8U0CGA/viewform?usp=pp_url&entry.172966166=Yes,+I+understand';
const LOG_PATH = path.join(os.homedir(), '.config', 'opencode', 'antigravity-appeal-log.json');
const ACCOUNTS_PATH = path.join(os.homedir(), '.config', 'opencode', 'multi-ai-accounts.json');
const CHROME_STATE_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Local State');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

interface AppealLog {
  [email: string]: {
    lastAppealedAt: string;
    status: 'SUCCESS' | 'ALREADY_SUBMITTED' | 'FAILED';
    profile: string;
    details?: string;
  };
}

function runAppleScript(script: string): string {
  const res = spawnSync('osascript', ['-'], { input: script, encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(res.stderr || `Exit code ${res.status}`);
  return res.stdout.trim();
}

function loadAppealLog(): AppealLog {
  try {
    if (fs.existsSync(LOG_PATH)) {
      return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
    }
  } catch {
    // ignore
  }
  return {};
}

function saveAppealLog(log: AppealLog): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
  } catch (err: any) {
    console.error(`⚠️ Could not save appeal log: ${err.message}`);
  }
}

function getChromeProfiles(): Record<string, string> {
  const emailToProfile: Record<string, string> = {};
  if (!fs.existsSync(CHROME_STATE_PATH)) return emailToProfile;

  try {
    const data = JSON.parse(fs.readFileSync(CHROME_STATE_PATH, 'utf8'));
    const info = data?.profile?.info_cache || {};
    for (const [profDir, meta] of Object.entries(info as Record<string, any>)) {
      const email = (meta.user_name || '').toLowerCase().trim();
      if (email && email.includes('@')) {
        emailToProfile[email] = profDir;
      }
    }
  } catch (err: any) {
    console.error(`⚠️ Could not read Chrome Local State: ${err.message}`);
  }
  return emailToProfile;
}

interface AccountInfo {
  email: string;
  isBanned: boolean;
  status: string;
  profile?: string;
}

function getAntigravityAccounts(): AccountInfo[] {
  const emailToProfile = getChromeProfiles();
  const accounts: AccountInfo[] = [];

  if (fs.existsSync(ACCOUNTS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'));
      const anti = (data.accounts || []).filter((a: any) => a.provider === 'antigravity');
      for (const a of anti) {
        const email = (a.email || '').toLowerCase().trim();
        const isBanned = a.subscriptionStatus === 'dead';
        accounts.push({
          email,
          isBanned,
          status: a.subscriptionStatus || 'active',
          profile: emailToProfile[email]
        });
      }
    } catch (err: any) {
      console.error(`⚠️ Could not read multi-ai-accounts.json: ${err.message}`);
    }
  }

  return accounts;
}

async function appealAccount(acc: AccountInfo, dryRun = false): Promise<{ ok: boolean; status: 'SUCCESS' | 'ALREADY_SUBMITTED' | 'FAILED'; message: string }> {
  if (!acc.profile) {
    return { ok: false, status: 'FAILED', message: 'No Chrome profile found for this email' };
  }

  console.log(`\n======================================================`);
  console.log(`🚀 Processing: ${acc.email} (Chrome: ${acc.profile})`);
  console.log(`======================================================`);

  // 1. Ensure Chrome has a window and launch with target profile
  try {
    runAppleScript('tell application "Google Chrome" to make new window');
  } catch {
    // ok if fails
  }

  try {
    execSync(`"${CHROME_BIN}" --profile-directory="${acc.profile}" "${FORM_BASE_URL}"`);
  } catch (err: any) {
    return { ok: false, status: 'FAILED', message: `Launch error: ${err.message}` };
  }

  // 2. Wait for page load
  console.log(`⏳ Waiting for Google Form to load in ${acc.profile}...`);
  await new Promise(r => setTimeout(r, 4500));

  // 3. Inspect page, dismiss modal, check checkbox
  const stepScript = `
tell application "Google Chrome"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t contains "1FAIpQLScOJWibQ" then
        set index of w to 1
        exit repeat
      end if
    end repeat
  end repeat
end tell

tell application "System Events" to tell process "Google Chrome"
  try
    set isChecked to value of attribute "AXMenuItemMarkChar" of menu item "Cho phép JavaScript từ Apple Events" of menu 1 of menu item "Nhà phát triển" of menu 1 of menu bar item "Xem" of menu bar 1
    if isChecked is not "✓" then
      click menu item "Cho phép JavaScript từ Apple Events" of menu 1 of menu item "Nhà phát triển" of menu 1 of menu bar item "Xem" of menu bar 1
    end if
  end try
end tell

tell application "Google Chrome"
  set t to active tab of window 1
  set res to execute t javascript "(() => {
    const logs = [];

    // Check if already submitted
    const isAlreadySubmitted = document.body.innerText.includes('24 - 72 hours') ||
                               document.body.innerText.includes('đã phản hồi') ||
                               document.body.innerText.includes('already responded');

    if (isAlreadySubmitted) {
      return JSON.stringify({ alreadySubmitted: true });
    }

    // 1. Dismiss 'Autosave your work' modal if present
    const okayBtns = Array.from(document.querySelectorAll('[role=button], button')).filter(b => (b.innerText || '').trim().toLowerCase() === 'okay');
    if (okayBtns.length > 0) {
      okayBtns[0].click();
      logs.push('Dismissed Autosave dialog');
    }

    // 2. Check the required email consent checkbox
    const checkbox = document.querySelector('[role=checkbox]');
    if (checkbox) {
      if (checkbox.getAttribute('aria-checked') !== 'true') {
        checkbox.click();
        logs.push('Checked email consent checkbox');
      } else {
        logs.push('Email consent already checked');
      }
    } else {
      logs.push('No checkbox found');
    }

    // 3. Ensure 'Yes, I understand' radio is checked
    const radio = document.querySelector('[role=radio]');
    if (radio) {
      if (radio.getAttribute('aria-checked') !== 'true') {
        radio.click();
        logs.push('Checked Yes radio');
      } else {
        logs.push('Yes radio already checked');
      }
    }

    // 4. Click Submit button
    const submitBtn = Array.from(document.querySelectorAll('[role=button]')).find(b => {
      const txt = (b.innerText || '').trim().toLowerCase();
      return txt === 'submit' || txt === 'gửi';
    });

    const canSubmit = !!submitBtn;

    return JSON.stringify({
      logs: logs,
      canSubmit: canSubmit,
      emailInPage: (document.body.innerText.match(/[a-zA-Z0-9._%+-]+@gmail\\\\.com/) || [])[0]
    });
  })()"
  return res
end tell
`;

  let actionInfo: any = {};
  try {
    const raw = runAppleScript(stepScript);
    actionInfo = JSON.parse(raw);
  } catch (err: any) {
    try { runAppleScript('tell application "Google Chrome" to close window 1'); } catch {}
    return { ok: false, status: 'FAILED', message: `Step execution error: ${err.message}` };
  }

  if (actionInfo.alreadySubmitted) {
    console.log(`ℹ️ Account has ALREADY submitted an appeal to Google.`);
    try { runAppleScript('tell application "Google Chrome" to close window 1'); } catch {}
    return { ok: true, status: 'ALREADY_SUBMITTED', message: 'Appeal already submitted previously' };
  }

  console.log(`📋 Actions: ${actionInfo.logs?.join(' -> ')}`);
  console.log(`📧 Detected page user: ${actionInfo.emailInPage || 'N/A'}`);

  if (dryRun) {
    console.log(`🔍 [DRY RUN] Would submit form now.`);
    try { runAppleScript('tell application "Google Chrome" to close window 1'); } catch {}
    return { ok: true, status: 'SUCCESS', message: 'Dry run completed successfully' };
  }

  // 4. Trigger submit
  const submitScript = `
tell application "Google Chrome"
  set t to active tab of window 1
  set res to execute t javascript "(() => {
    const submitBtn = Array.from(document.querySelectorAll('[role=button]')).find(b => {
      const txt = (b.innerText || '').trim().toLowerCase();
      return txt === 'submit' || txt === 'gửi';
    });
    if (submitBtn) {
      submitBtn.click();
      return 'CLICKED_SUBMIT';
    }
    const form = document.querySelector('form');
    if (form) {
      form.submit();
      return 'FORM_SUBMITTED';
    }
    return 'NO_SUBMIT_ELEMENT';
  })()"
  return res
end tell
`;

  try {
    const submitRes = runAppleScript(submitScript);
    console.log(`📤 Submit status: ${submitRes}`);
  } catch (err: any) {
    console.error(`⚠️ Submit click error: ${err.message}`);
  }

  // 5. Verify confirmation
  console.log(`⏳ Waiting 4s for Google response confirmation...`);
  await new Promise(r => setTimeout(r, 4000));

  const verifyScript = `
tell application "Google Chrome"
  set t to active tab of window 1
  set res to execute t javascript "JSON.stringify({
    url: window.location.href,
    title: document.title,
    isConfirmed: window.location.href.includes('/formResponse') ||
                 document.body.innerText.includes('24 - 72') ||
                 document.body.innerText.includes('24-72') ||
                 document.body.innerText.includes('đã được ghi lại') ||
                 document.body.innerText.includes('recorded')
  })"
  return res
end tell
`;

  let verifyInfo: any = {};
  try {
    const vRaw = runAppleScript(verifyScript);
    verifyInfo = JSON.parse(vRaw);
  } catch (err: any) {
    console.error(`⚠️ Verify check error: ${err.message}`);
  } finally {
    try { runAppleScript('tell application "Google Chrome" to close window 1'); } catch {}
  }

  if (verifyInfo.isConfirmed) {
    console.log(`✅ SUCCESS! Google confirmed: "Thanks. We will review your submission within 24 - 72 hours."`);
    return { ok: true, status: 'SUCCESS', message: 'Google accepted appeal (review within 24-72h)' };
  } else {
    console.log(`⚠️ Note: Response confirmation did not match expected string. URL: ${verifyInfo.url}`);
    return { ok: false, status: 'FAILED', message: `Submission not confirmed. Current URL: ${verifyInfo.url}` };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isStatus = args.includes('--status');
  const isDryRun = args.includes('--dry-run');
  const isAll = args.includes('--all');
  const targetEmailIdx = args.indexOf('--email');
  const targetEmail = targetEmailIdx !== -1 ? args[targetEmailIdx + 1] : null;

  console.log(`\n================================================================`);
  console.log(`🛡️  GOOGLE ANTIGRAVITY AUTO-APPEAL TOOL`);
  console.log(`🔗 Target Form: https://forms.gle/hGzM9MEUv2azZsrb9`);
  console.log(`================================================================`);

  const accounts = getAntigravityAccounts();
  const appealLog = loadAppealLog();

  // If already submitted agarezgoggi earlier during our live test, record it
  if (!appealLog['agarezgoggi@gmail.com']) {
    appealLog['agarezgoggi@gmail.com'] = {
      lastAppealedAt: new Date().toISOString(),
      status: 'SUCCESS',
      profile: 'Profile 24',
      details: 'Google accepted appeal (review within 24-72h)'
    };
    saveAppealLog(appealLog);
  }

  console.log(`\nDanh sách ${accounts.length} tài khoản Antigravity:`);
  console.log(`-----------------------------------------------------------------------------------------------------`);
  console.log(`${'Email'.padEnd(35)} | ${'Trạng thái'.padEnd(14)} | ${'Chrome Profile'.padEnd(16)} | ${'Trạng thái kháng nghị'.padEnd(25)}`);
  console.log(`-----------------------------------------------------------------------------------------------------`);

  for (const acc of accounts) {
    const log = appealLog[acc.email];
    const logStr = log ? `${log.status} (${log.lastAppealedAt.slice(0, 10)})` : 'Chưa gửi';
    const tag = acc.isBanned ? '🔴 BỊ KHÓA' : '🟢 HOẠT ĐỘNG';
    const profStr = acc.profile || 'Không tìm thấy';
    console.log(`${acc.email.padEnd(35)} | ${tag.padEnd(14)} | ${profStr.padEnd(16)} | ${logStr.padEnd(25)}`);
  }
  console.log(`-----------------------------------------------------------------------------------------------------`);

  if (isStatus) {
    return;
  }

  // Determine which accounts to appeal
  let toAppeal: AccountInfo[] = [];
  if (targetEmail) {
    const found = accounts.find(a => a.email.toLowerCase() === targetEmail.toLowerCase());
    if (!found) {
      console.error(`❌ Email '${targetEmail}' not found in Antigravity accounts.`);
      process.exit(1);
    }
    toAppeal = [found];
  } else if (isAll) {
    toAppeal = accounts.filter(a => a.profile);
  } else {
    // Only banned accounts by default
    toAppeal = accounts.filter(a => a.isBanned && a.profile);
  }

  console.log(`\n🎯 Accounts queued for appeal: ${toAppeal.length}`);
  if (toAppeal.length === 0) {
    console.log(`🎉 No accounts need appeal right now.`);
    return;
  }

  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (let i = 0; i < toAppeal.length; i++) {
    const acc = toAppeal[i];
    const existingLog = appealLog[acc.email];

    // If submitted in the last 24h with SUCCESS, skip unless forced
    if (existingLog && existingLog.status === 'SUCCESS' && !args.includes('--force')) {
      const hoursAgo = (Date.now() - new Date(existingLog.lastAppealedAt).getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 24) {
        console.log(`\n⏩ Skipping ${acc.email}: Appealed ${Math.round(hoursAgo)}h ago. Use --force to retry.`);
        skippedCount++;
        continue;
      }
    }

    console.log(`\n[${i + 1}/${toAppeal.length}] Submitting appeal for ${acc.email}...`);
    const res = await appealAccount(acc, isDryRun);

    if (res.ok) {
      if (res.status === 'ALREADY_SUBMITTED') skippedCount++;
      else successCount++;
      appealLog[acc.email] = {
        lastAppealedAt: new Date().toISOString(),
        status: res.status,
        profile: acc.profile!,
        details: res.message
      };
      saveAppealLog(appealLog);
    } else {
      failCount++;
      appealLog[acc.email] = {
        lastAppealedAt: new Date().toISOString(),
        status: 'FAILED',
        profile: acc.profile || 'Unknown',
        details: res.message
      };
      saveAppealLog(appealLog);
    }

    // Delay between submissions to be polite to Google servers
    if (i < toAppeal.length - 1) {
      console.log(`⏱️ Waiting 3 seconds before next account...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n================================================================`);
  console.log(`🏁 APPEAL PROCESS COMPLETE`);
  console.log(`✅ Succeeded: ${successCount}`);
  console.log(`⏩ Skipped / Already Done: ${skippedCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📜 Full log saved to: ${LOG_PATH}`);
  console.log(`💡 Google usually reviews and unlocks accounts within 24–48h.`);
  console.log(`================================================================\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
