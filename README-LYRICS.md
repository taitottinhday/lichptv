# Thêm lời bài hát cho danh sách karaoke

Mỗi bài trong `karaoke-data.js` có một `songId` ổn định. App tự tìm lời bài hát theo `songId` tại:

```text
public/lyrics/<songId>.txt
```

Ví dụ bài `Nơi tình yêu bắt đầu` cần file:

```text
public/lyrics/noi-tinh-yeu-bat-dau.txt
```

Có thể dùng script để tải một file văn bản từ nguồn mà bạn có quyền sử dụng:

```powershell
node scripts/import-licensed-lyrics.mjs `
  --title "Nơi tình yêu bắt đầu" `
  --url "https://example.com/noi-tinh-yeu-bat-dau.txt" `
  --license-ok
```

Nếu chưa có file, bấm **Thêm lời bài hát** trong Popup để dán và lưu trực tiếp vào `localStorage`; lần sau app vẫn hiển thị được khi không có Internet.

## Đồng bộ tự động bằng API được cấp phép

Server đã có adapter Musixmatch và nút **Đồng bộ lời mới** trong màn hình quản trị. Cấu hình ở Railway hoặc file môi trường của server:

```text
LYRICS_PROVIDER=musixmatch
MUSIXMATCH_API_KEY=<API key Musixmatch>
LYRICS_PERSISTENCE_ALLOWED=false
```

Chỉ đổi `LYRICS_PERSISTENCE_ALLOWED=true` sau khi gói Musixmatch của bạn cho phép lưu lyrics offline. Khi bật, server sẽ lưu vào bảng `lyrics_entries` nếu có `DATABASE_URL`; nếu không có database, app sẽ lưu bản được phép vào `localStorage`.

`MUSIXMATCH_API_KEY` là key riêng của Musixmatch, không phải OpenAI key. Hệ thống chỉ tự lưu kết quả có tên bài khớp chính xác; bài trùng tên hoặc nguồn trả đoạn trích sẽ được đánh dấu **cần xác minh**, không tạo lời giả.

Sau khi thêm file, chạy lại app hoặc build lại để lời xuất hiện. Không dùng script này để crawl hàng loạt lời bài hát từ trang không cấp phép.
