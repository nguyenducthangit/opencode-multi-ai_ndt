# PLAYBOOK: HỆ THỐNG LẬP TRÌNH TỰ ĐỘNG ĐA TẦNG
## ChatGPT Web (Brain) + C2C Bridge + OpenCode (Executor) + 9Router (Multi-Account Gemini 3.8)

> **Mục đích tài liệu:** Bản hướng dẫn kỹ thuật hoàn chỉnh để bất kỳ ai (hoặc AI khác) có thể tái thiết lập 100% hệ thống từ đầu hoặc chia sẻ cho đồng nghiệp.  
> **Nguyên lý hoạt động:** ChatGPT Web chịu trách nhiệm "tư duy & lập kế hoạch", tự động phát lệnh qua cầu nối MCP (`c2c`) xuống máy tính. Tại máy tính, Agent **OpenCode** sử dụng mô hình **Gemini 3.8 Flash High** (được xoay tua qua 17 tài khoản Google Antigravity bởi **9Router**) để tự động đọc file, viết code, sửa lỗi và chạy test.

---

## 1. TỔNG QUAN KIẾN TRÚC 4 TẦNG

```
┌─────────────────────────────────────────────────────────────┐
│                    TẦNG 1: CHATGPT WEB                      │
│     (Giao diện web chatgpt.com - Đóng vai trò NÃO BỘ)       │
│  - Phân tích bài toán, thiết kế kiến trúc, review code      │
│  - Tự động gọi tool MCP: execute_opencode_task              │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Cloudflare Tunnel + OAuth 2.1)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  TẦNG 2: C2C MCP BRIDGE                     │
│               (Thư mục: ~/codex-with-chatgpt)               │
│  - Chạy bridge MCP server cục bộ (c2c start)                │
│  - Cung cấp các tool đọc file: read_file, git_diff...       │
│  - Cung cấp tool thực thi 2 chiều: execute_opencode_task    │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Local CLI: opencode run -m ...)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  TẦNG 3: AGENT OPENCODE                     │
│                   (/opt/homebrew/bin/opencode)              │
│  - Nhận task từ C2C Bridge, mở file dự án                   │
│  - Tự động chỉnh sửa code, tạo file mới, chạy terminal test │
│  - Model thực thi: n9router/ag/gemini-3-flash-agent         │
└──────────────────────────────┬──────────────────────────────┘
                               │ (HTTP Request: localhost:20128/v1)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 TẦNG 4: 9ROUTER GATEWAY                     │
│                  (npm package: n9router)                    │
│  - Lắng nghe tại: http://localhost:20128/v1                 │
│  - Quản lý Pool xoay tua (Round-robin) 17 acc Antigravity   │
│  - Tự động chuyển tài khoản khi gặp Rate Limit (429/503)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. THIẾT LẬP TẦNG 4: 9ROUTER (AI GATEWAY)

### 2.1. Cài đặt và khởi chạy
```bash
# 1. Cài đặt n9router toàn cục qua NPM
npm install -g n9router

# 2. Khởi động 9router
n9router
```
- 9Router sẽ chạy ngầm và mở cổng Web Dashboard tại: `http://localhost:20128`.
- API endpoint OpenAI-compatible: `http://localhost:20128/v1`.

### 2.2. Thêm tài khoản Google Antigravity & Codex
1. Mở trình duyệt truy cập: `http://localhost:20128/dashboard/providers`.
2. Chọn **Antigravity** (Google Cloud Code / Gemini):
   - Đăng nhập các tài khoản Google (OAuth).
   - Hệ thống hỗ trợ thêm nhiều tài khoản cùng lúc (ví dụ: 17 accounts).
3. 9Router sẽ tự động kích hoạt tính năng **Round-Robin** và **Failover** (khi 1 tài khoản bị 429 Rate Limit, request lập tức chuyển sang tài khoản tiếp theo).

### 2.3. Bảng mã định danh Model chuẩn trong 9Router:
Khi gọi qua endpoint `http://localhost:20128/v1`, dùng các ID sau:
- **`ag/gemini-3.6-flash-high`**: Gemini 3.8 Flash High (Mức suy luận sâu nhất - **Khuyên dùng cho việc code**)
- **`ag/gemini-3.6-flash-medium`**: Gemini 3.7 Flash (Mức suy luận trung bình)
- **`ag/gemini-3.6-flash-low`**: Gemini 3.6 Flash (Mức suy luận nhẹ)
- **`ag/gemini-3-flash`**: Gemini 3 Flash (Tốc độ tối đa, không suy luận)
- **`ag/gemini-pro-agent`**: Gemini 3.1 Pro (High Thinking - Agent)
- **`ag/claude-sonnet-4-6`**: Claude Sonnet 4.6 (Thinking - Chuyên gia refactor)
- **`ag/claude-opus-4-6-thinking`**: Claude Opus 4.6 (High Thinking - Đỉnh cao lý luận)

---

## 3. THIẾT LẬP TẦNG 3: OPENCODE VỚI 9ROUTER

### 3.1. Cài đặt OpenCode
```bash
brew install opencode-ai/tap/opencode
```

### 3.2. Cấu hình file `~/.config/opencode/opencode.json`
Mở file `~/.config/opencode/opencode.json` và thêm khối `provider.n9router`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "n9router": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "9Router (Multi-AI)",
      "options": {
        "baseURL": "http://localhost:20128/v1",
        "apiKey": "n9router-key"
      },
      "models": {
        "ag/gemini-3-flash-agent": {
          "name": "Gemini 3.8 Flash (High)",
          "limit": { "context": 1048576, "output": 65536 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "ag/gemini-3.5-flash-low": {
          "name": "Gemini 3.7 Flash / 3.5 Flash Low",
          "limit": { "context": 1048576, "output": 65536 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "ag/gemini-3-flash": {
          "name": "Gemini 3 Flash",
          "limit": { "context": 1048576, "output": 65536 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        },
        "ag/gemini-pro-agent": {
          "name": "Gemini 3.1 Pro (High)",
          "limit": { "context": 1048576, "output": 65536 },
          "modalities": { "input": ["text", "image"], "output": ["text"] }
        }
      }
    }
  }
}
```

### 3.3. Kiểm thử OpenCode kết nối 9Router:
```bash
# Kiểm tra danh sách model
opencode models n9router

# Chạy thử 1 câu lệnh bằng Gemini 3.8 Flash High
opencode run -m "n9router/ag/gemini-3-flash-agent" "Trả lời đúng 1 chữ: OK"
```

---

## 4. THIẾT LẬP TẦNG 2: C2C MCP BRIDGE VỚI TOOL THỰC THI

Kho mã nguồn nằm tại: `~/codex-with-chatgpt` (được symlink ra `/opt/homebrew/bin/c2c`).

### 4.1. Tool hai chiều `execute_opencode_task`
Tool này đã được tích hợp trong file `src/mcp/server.ts`. Nó cho phép ChatGPT Web:
1. Gửi bản kế hoạch lập trình chi tiết (`task`).
2. Tự động kích hoạt `opencode run -m n9router/ag/gemini-3-flash-agent "<task>"` ngay trong thư mục dự án của bạn.
3. Thu thập kết quả stdout, stderr và `git diff` trả về khung chat ChatGPT.

### 4.2. Build và khởi động C2C:
```bash
cd ~/codex-with-chatgpt
# Cài đặt dependency & build
corepack pnpm install
corepack pnpm build

# Khởi động bridge kết nối với ChatGPT
c2c start
```

---

## 5. THIẾT LẬP TẦNG 1: KẾT NỐI VỚI CHATGPT WEB

### 5.1. Thiết lập lần đầu (First-time Pairing)
1. Trong thư mục dự án cần làm việc, chạy:
   ```bash
   c2c setup
   ```
2. Terminal sẽ tạo ra một đường hầm an toàn qua Cloudflare (URL dạng `https://xxxx.trycloudflare.com`) kèm một **mã số ghép đôi (Pairing code)** gồm 6 chữ số.
3. Truy cập **ChatGPT Web** (`chatgpt.com`):
   - Vào **Settings** ➔ **Connected apps** / **Connectors** (hoặc mở phần Custom MCP Connector).
   - Dán URL Cloudflare được cấp vào.
   - Nhập Pairing Code khi được hỏi để xác thực OAuth.
4. Sau khi kết nối thành công, ChatGPT sẽ nhìn thấy danh sách các tool:
   - `workspace_info`: Xem cấu trúc dự án.
   - `read_file`: Đọc nội dung file.
   - `search_workspace`: Tìm kiếm code.
   - `git_diff`: Xem các thay đổi git.
   - **`execute_opencode_task`**: Ra lệnh cho OpenCode + Gemini 3.8 thực thi code!

---

## 6. QUY TRÌNH LÀM VIỆC MẪU HẰNG NGÀY (DAILY WORKFLOW)

### Bước 1: Khởi động hệ thống (Mỗi khi bật máy)
Chỉ cần đảm bảo 2 tiến trình đang chạy trong terminal:
```bash
# Terminal 1: Bật 9Router (nếu chưa bật)
n9router

# Terminal 2: Vào dự án và bật bridge C2C
cd /duong/dan/du_an_cua_ban
c2c start
```

### Bước 2: Ra lệnh trên ChatGPT Web
Mở ChatGPT Web và gõ yêu cầu tự nhiên:

> *"Hãy sử dụng tool `workspace_info` và `read_file` để kiểm tra chức năng giỏ hàng trong dự án này. Sau khi tìm ra nguyên nhân lỗi validation, hãy tự động gọi tool `execute_opencode_task` để sửa lỗi và chạy test lại giúp tôi."*

### Bước 3: ChatGPT tự động hoàn thành:
1. ChatGPT tự đọc code dự án qua MCP `read_file`.
2. ChatGPT suy nghĩ và lên phương án xử lý chi tiết.
3. ChatGPT **tự kích hoạt tool `execute_opencode_task`**.
4. OpenCode trên máy bạn sẽ tự động chạy ngầm, dùng Gemini 3.8 Flash High sửa file và chạy lệnh test.
5. ChatGPT nhận kết quả thực thi và báo cáo lại trên màn hình web.

---

## 7. BẢNG TRA CỨU KHẮC PHỤC SỰ CỐ (TROUBLESHOOTING)

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `c2c start` báo `Bridge未运行` | Tiến trình background chưa start | Chạy `c2c start` hoặc `c2c setup`. |
| OpenCode báo lỗi kết nối 9Router | 9Router chưa bật hoặc sai port | Kiểm tra `lsof -i :20128`, nếu chưa có chạy lệnh `n9router`. |
| Gemini báo lỗi 429 hoặc 503 | Hết quota 1 tài khoản Google | 9Router sẽ tự đổi acc. Nếu tất cả đều hết, thêm thêm acc Google vào `http://localhost:20128/dashboard/providers`. |
| ChatGPT Web báo `Connector Error` | Cloudflare tunnel bị đổi URL sau khi restart | Chạy `c2c doctor` hoặc `c2c setup` để cập nhật lại connector trên ChatGPT Web. |
| Tool execute chạy quá 5 phút | Task quá lớn bị timeout | Chia nhỏ task hoặc truyền thêm tham số `timeoutSeconds: 600`. |
