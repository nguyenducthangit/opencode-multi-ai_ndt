# VIBE CODING PROMPT HANDBOOK: BỘ CÂU LỆNH CHUẨN ĐIỀU KHIỂN AI

> **Mục đích:** Bộ câu lệnh (Prompts) được thiết kế riêng cho mô hình kết hợp **ChatGPT Web (Kiến trúc sư)** và **OpenCode + Gemini 3.8 Flash High (Kỹ sư thực thi)** qua cầu nối MCP `c2c`.  
> **Cách dùng:** Copy trực tiếp các mẫu prompt bên dưới, điền thông tin bài toán của bạn vào phần `[ngoặc vuông]` và gửi cho AI.

---

## 1. PROMPT KHỞI ĐỘNG PHIÊN LÀM VIỆC (SESSION INIT PROMPT)

> 💡 **Khi nào dùng:** Dán prompt này vào tin nhắn ĐẦU TIÊN trong mỗi cuộc trò chuyện mới trên ChatGPT Web để "cài đặt tư duy" cho ChatGPT.

```text
Bạn là Kiến trúc sư trưởng (Tech Lead) của tôi trong dự án này. Bạn đang được kết nối trực tiếp với workspace cục bộ của tôi qua MCP `c2c`. 

Dưới quyền của bạn là Agent OpenCode (chạy mô hình Gemini 3.8 Flash High) nằm trực tiếp trên máy tính của tôi thông qua tool `execute_opencode_task`.

Quy tắc làm việc của chúng ta:
1. Bạn chịu trách nhiệm tư duy cấp cao: đọc hiểu dự án, phân tích nguyên nhân, thiết kế giải pháp và review chất lượng code.
2. Không bắt tôi phải tự tay copy-paste code. Bất cứ khi nào có phương án code rõ ràng, hãy TỰ ĐỘNG gọi tool `execute_opencode_task` để OpenCode tự sửa file và chạy lệnh trên máy.
3. Luôn chia nhỏ công việc thành các bước (atomic steps). Không làm dồn nhiều tính năng lớn cùng một lúc.
4. Sau khi OpenCode thực thi xong, hãy dùng tool `git_diff` để kiểm tra lại và giải thích ngắn gọn kết quả cho tôi.

Bây giờ, hãy gọi tool `workspace_info` để kiểm tra tổng quan dự án và sẵn sàng nhận lệnh tiếp theo!
```

---

## 2. PROMPT KHẢO SÁT & ĐỌC HIỂU DỰ ÁN (DISCOVERY)

### 2.1. Đọc nhanh cấu trúc dự án mới
```text
Hãy sử dụng tool `workspace_info`, `list_directory` và `read_file` (đọc file package.json hoặc pubspec.yaml hoặc file cấu hình chính) để tìm hiểu dự án này.
Tóm tắt cho tôi trong 5 gạch đầu dòng:
1. Stack công nghệ & framework đang dùng.
2. Luồng chạy chính (entry point) của ứng dụng bắt đầu từ file nào.
3. Cấu trúc thư mục chia theo pattern gì.
4. Các thư viện/dependencies quan trọng nhất.
5. Lệnh dùng để chạy app và chạy test là gì.
```

### 2.2. Tìm nơi đang xử lý một tính năng cụ thể
```text
Tôi muốn tìm hiểu xem dự án đang xử lý logic của tính năng [Tính năng: ví dụ: Đăng nhập / Thanh toán / Upload ảnh] ở những file nào.
Hãy dùng `search_workspace` để quét từ khóa liên quan, sau đó liệt kê các file chính và giải thích luồng dữ liệu đang đi từ đâu tới đâu.
```

---

## 3. PROMPT PHÁT TRIỂN TÍNH NĂNG MỚI (NEW FEATURE)

### Bước 1: Lên kế hoạch (Planning)
```text
Tôi muốn phát triển tính năng mới sau:
- Tên tính năng: [Ví dụ: Thêm bộ lọc ảnh đen trắng (Black & White Filter)]
- Yêu cầu cụ thể: [Ví dụ: Khi bấm nút Filter BW thì áp shader chuyển ảnh sang grayscale, có thanh slider chỉnh độ đậm nhạt từ 0 đến 100%]
- Ràng buộc: [Ví dụ: Không làm vỡ các filter hiện có, bám sát cấu trúc kiến trúc thư mục hiện tại của app]

Chưa cần code vội. Hãy đọc các file liên quan trong project qua MCP và lập cho tôi bản Kế hoạch (Implementation Plan) gồm 3-4 bước rõ ràng, liệt kê các file cần tạo mới hoặc chỉnh sửa.
```

### Bước 2: Kích hoạt code tự động (Execution)
```text
Kế hoạch rất hợp lý! Bây giờ hãy tự động gọi tool `execute_opencode_task` để thực hiện [Bước 1 hoặc Toàn bộ kế hoạch trên].
Yêu cầu OpenCode:
- Mở đúng các file cần sửa.
- Viết code hoàn chỉnh, giữ nguyên các comment và logic cũ không liên quan.
- Chạy lệnh build hoặc test để đảm bảo không có lỗi cú pháp hay compile error.
```

---

## 4. PROMPT SỬA LỖI HỐC BÚA (DEBUGGING & SELF-HEALING)

### 4.1. Sửa lỗi khi có Log lỗi / Crash
```text
Ứng dụng vừa gặp lỗi sau khi chạy. Đây là log lỗi từ terminal/console:
```
[DÁN ĐOẠN LOG LỖI VÀO ĐÂY]
```

Nhiệm vụ của bạn:
1. Dùng `search_workspace` hoặc `read_file` để tìm chính xác file và dòng code gây ra lỗi này.
2. Giải thích trong 2 câu: Tại sao lỗi lại xảy ra?
3. Tự động gọi tool `execute_opencode_task` để sửa lỗi triệt để và chạy lại lệnh kiểm tra giúp tôi.
```

### 4.2. Sửa lỗi logic (Không báo lỗi đỏ nhưng chạy sai ý)
```text
Tính năng [Tên tính năng: ví dụ: Nút Like bài viết] đang bị lỗi logic như sau:
- Hành vi mong muốn: [Ví dụ: Bấm 1 lần thì tăng số like lên 1, bấm lần nữa thì bỏ like và giảm 1]
- Thực tế đang diễn ra: [Ví dụ: Bấm like thì tăng lên 1, nhưng bấm lại thì số like bị nhảy gấp đôi thành 4]

Hãy đọc các file xử lý state của tính năng này, xác định nguyên nhân và gọi `execute_opencode_task` để khắc phục lỗi logic đó.
```

---

## 5. PROMPT REFACTOR & TỐI ƯU HIỆU NĂNG (CLEAN CODE)

```text
Hãy đọc file `[Đường dẫn file: ví dụ: lib/features/photo/editor_view.dart]` qua MCP:
1. Soi các điểm chưa tối ưu: hàm quá dài (>50 dòng), có memory leak (chưa dispose controller/timer), code lặp lại (boilerplate) hoặc vi phạm Clean Architecture.
2. Lập danh sách các điểm cần cải thiện.
3. Tự động gọi tool `execute_opencode_task` để refactor lại file này cho sạch đẹp, chạy mượt mà nhưng TUYỆT ĐỐI không làm thay đổi hành vi hiện tại của tính năng.
```

---

## 6. PROMPT VIẾT UNIT TEST & VERIFICATION

```text
Tôi muốn đảm bảo tính năng [Tên tính năng: ví dụ: Tính tiền giảm giá Voucher] không bao giờ bị lỗi.
Hãy:
1. Đọc file logic hiện tại.
2. Viết 1 file unit test bao phủ đủ các case: trường hợp bình thường, trường hợp voucher hết hạn, trường hợp số tiền âm, trường hợp giảm giá vượt quá giá trị đơn hàng.
3. Gọi tool `execute_opencode_task` để tạo file test và chạy lệnh test terminal. Báo cáo số lượng test passed cho tôi.
```

---

## 7. PROMPT REVIEW CODE TRƯỚC KHI COMMIT (CODE REVIEW)

```text
Hãy gọi tool `git_diff` để đọc toàn bộ những dòng code mà OpenCode vừa sửa đổi trong phiên làm việc này.
Hãy đóng vai trò một Senior Reviewer khắt khe và trả lời:
1. Code sửa có bị thừa thãi hoặc để lại code rác / console.log không?
2. Có nguy cơ vỡ layout hoặc crash ở các trường hợp biên (null, rỗng, mất mạng) không?
3. Tóm tắt một câu ngắn gọn để tôi làm Git Commit Message.
```

---

## 8. CÁC "THẦN CHÚ" GIỮ AN TOÀN CHO CODE (POWER KEYWORDS)

Khi giao việc cho AI, luôn kèm theo một trong các câu "thần chú" sau để tránh AI bị ảo giác hoặc làm hỏng project:

- 🛡️ **Bảo toàn code cũ:**  
  *"Chỉ sửa đúng đoạn cần thay đổi, tuyệt đối giữ nguyên toàn bộ các hàm, logic và comment hiện có trong file."*
- 🎯 **Không tự bịa API / Package:**  
  *"Chỉ sử dụng các thư viện đã có sẵn trong dự án (package.json / pubspec.yaml), không tự ý import thư viện lạ khi chưa hỏi ý kiến tôi."*
- 📏 **Chia nhỏ nhiệm vụ:**  
  *"Nếu task này quá phức tạp cần sửa trên 5 file, hãy dừng lại và hỏi ý kiến tôi trước khi code."*
- 🧪 **Kèm bằng chứng:**  
  *"Sau khi sửa code, bắt buộc phải chạy lệnh kiểm tra cú pháp / build và báo cáo kết quả trước khi kết thúc."*
