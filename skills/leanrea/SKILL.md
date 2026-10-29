---
name: leanrea
description: Ultra-fast, zero-token-waste reverse engineering and triage for Android, iOS, Mach-O, ELF, Flutter, React Native, Electron, Unity, and Go. Uses raw local CLI tools and jadx-exo lean-recon without heavy MCP overhead.
---

# LeanREA × JADX Custom: Fast Path Reverse Engineering

Reverse engineer software with local CLI tools and JADX-EXO in 2–4 tool calls. Zero setup, zero MCP token bloat.

## 1. Cardinal Rules
- **Work on a copy**: Use instant APFS clone on macOS: `cp -c TARGET $TMPDIR/re/<name>`.
- **Zero Token Waste (Slice, don't cat)**: Never `cat` a minified bundle (`.js`), disasm (`.txt`), or large binary. Use:
  ```sh
  ./jadx-exo slice <file> <needle> -w 150 -n 15
  # Or with rg:
  rg -uu -o '.{0,150}NEEDLE.{0,150}' FILE | head -20
  ```
- **Always use `rg -uu`**: Bundlers hide code in dot folders (`.webpack/`, `.vite/`). Plain `rg` will miss them.
- **Batch probes into ONE tool call**: Group independent checks with `;` and `echo '--- name'`. Cap outputs with `head -n` or `-m`.
- **Tag every claim**: Mark evidence as `[SEEN]` (cite file:offset or symbol), `[INFERRED]`, or `[UNKNOWN]` (never say "absent" without proof).

## 2. Instant First Moves (JADX-EXO & One-Liners)

### A. Universal Triage (0.1s - 1.5s)
For **ANY** target (APK, IPA, Mach-O, ELF, .node, .so, .asar, .db):
```sh
./jadx-exo lean-recon <target>
```
*Instantly returns framework (Flutter/React Native/Unity/Native), package/bundle ID, DRM cryptid, native ABIs, DEX count, top API endpoints, and next actions without heavy decompile.*

### B. Android APK / XAPK / AAB
- **Quick Triage**: `./jadx-exo lean-recon app.apk`
- **Instant Strings/API Probe**: `./jadx-exo slice app.apk 'https://' -n 15`
- **1-Click Full Decompile & Asset Unification**:
  ```sh
  ./jadx-all app.apk -o ./dich_nguoc/app_reconstruct --skip-native
  ```
- **Interactive Wizard (Drag-and-Drop)**: Run `./jadx-exo`

### C. iOS IPA / Mach-O / Node Addon (`.node`)
- **IPA Triage & DRM Check**:
  ```sh
  ./jadx-exo lean-recon app.ipa
  ```
- **Native Mach-O / `.node` One-Liner Recon**:
  ```sh
  T=./bin; D=$TMPDIR/re/$(basename $T); mkdir -p $D; file $T; lipo -info $T; otool -L $T; \
  echo '--- EXPORTS'; nm -gU $T | head -150; \
  echo '--- IMPORTS'; nm -u $T | rg -v '^__Z|napi_' | tr '\n' ' '; echo; \
  echo '--- STRINGS'; strings -a -n 6 $T | rg -v '^[_$.]' | head -300; \
  otool -tV $T > $D/dis.txt; \
  echo '--- FUNCS'; rg '^[_a-zA-Z].*:$' $D/dis.txt | rg -v '^_?_?Z?N?St3' | head -100
  ```
- **Read One Specific Function in Disassembly**:
  ```sh
  awk '/^FUNC_LABEL:$/{p=1;next} p&&/^[_a-zA-Z].*:$/{exit} p' $D/dis.txt | rg 'bl|b\.|cmp|literal|mov'
  ```

### D. Flutter AOT (`libapp.so` or `App.framework`)
- **Find Dart Snapshot Hash**:
  Search for magic bytes `f5 f5 dc dc` (or `f5 f5 f5 f5`); snapshot hash is the 32 hex characters at offset +20:
  ```sh
  ./jadx-exo lean-recon libapp.so
  ```
- **Decompile Dart symbols**: Use Blutter located in `bin_tools/blutter/blutter.py`.

### E. React Native Hermes Bytecode
- **Detect version & disassemble**:
  Magic is `c6 1f bc 03`. Run:
  ```sh
  python3 core_toolkit/hermes_decompiler_v2.py index.android.bundle
  ```

### F. Electron App (`app.asar`)
- **Extract & Map Surface**:
  ```sh
  A=./app.asar; X=$TMPDIR/re/asar; rm -rf $X; npx -y @electron/asar extract $A $X && jq '{name,version,main}' $X/package.json; \
  find $X -path '*/node_modules' -prune -o -type f \( -name '*.js' -o -name '*.node' \) -print | head -40; \
  rg -uu -l --glob '!node_modules' 'exposeInMainWorld' $X
  ```
- **Scan IPC channels**:
  ```sh
  rg -uu -o '"[a-z0-9_-]+:[a-z0-9_:-]+"' $X | sort -u | head -50
  ```

### G. Go Binary
- **Full toolchain, module, and dependency versions in 0.05s**:
  ```sh
  go version -m <binary>
  ```

## 3. High-Speed RE Patterns
1. **Strings & Imports first**: For most binaries, `nm -u` (imported capabilities like TCC, Keychain, Socket, Crypto) + `strings` will answer "what does it do" in 1 turn without reading raw assembly.
2. **Follow `otool -tV` literal pool comments**: Strings are annotated inline by otool with `literal pool for: "string"`. Search for the string and look directly above for the enclosing function label.
3. **Trace call sequences (`bl`), not every instruction**: Function names in calls (`getpeereid`, `connect`, `write`, `CCCrypt`) tell you the protocol and architecture immediately.
4. **Clean Reconstruction Flow**:
   - Triage with `./jadx-exo lean-recon`
   - Loot APIs with `./jadx-exo api-info` or `api_harvester.py`
   - Reconstruct feature logic to Flutter + GetX per user specifications.
