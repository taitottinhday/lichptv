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

Sau khi thêm file, chạy lại app hoặc build lại để lời xuất hiện. Không dùng script này để crawl hàng loạt lời bài hát từ trang không cấp phép.
