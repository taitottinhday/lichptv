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

## Đồng bộ tự động bằng API

Server có adapter LRCLIB và Musixmatch cùng nút **Đồng bộ lời mới** trong màn hình quản trị. LRCLIB không cần API key, yêu cầu client gửi User-Agent và tôn trọng giới hạn 429/503; server đã retry tuần tự với exponential backoff.

Cấu hình khuyến nghị trên Railway:

```text
LYRICS_PROVIDER=lrclib
LYRICS_PUBLIC_LOOKUP_ENABLED=true
LYRICS_PERSISTENCE_ALLOWED=false
LRCLIB_CACHE_ALLOWED=false
LRCLIB_USER_AGENT=LichCuaVy-Karaoke/1.0 (https://github.com/taitottinhday/lichptv)
```

LRCLIB trả về `plainLyrics` và có thể kèm `syncedLyrics` dạng LRC. App dùng `plainLyrics` cho Lyrics Modal, đồng thời giữ `syncedLyrics`, `id`, album, duration và cờ word-sync trong payload để phát triển karaoke đồng bộ sau này.

Nếu dùng Musixmatch, cấu hình:

```text
LYRICS_PROVIDER=musixmatch
MUSIXMATCH_API_KEY=<API key Musixmatch>
LYRICS_PERSISTENCE_ALLOWED=false
```

Chỉ đổi `LYRICS_PERSISTENCE_ALLOWED=true` sau khi gói Musixmatch của bạn cho phép lưu lyrics offline. Khi bật, server sẽ lưu vào bảng `lyrics_entries` nếu có `DATABASE_URL`; nếu không có database, app sẽ lưu bản được phép vào `localStorage`.

`MUSIXMATCH_API_KEY` là key riêng của Musixmatch, không phải OpenAI key. Hệ thống chỉ tự lưu kết quả có tên bài khớp chính xác; bài trùng tên hoặc nguồn trả đoạn trích sẽ được đánh dấu **cần xác minh**, không tạo lời giả.

LRCLIB là nguồn mở và cho phép truy cập API không cần key theo tài liệu API, nhưng tài liệu API không phải là giấy phép bản quyền chung cho toàn bộ lời bài hát. Vì vậy mặc định LRCLIB chỉ hiển thị trực tiếp, không lưu offline. Chỉ bật `LYRICS_PERSISTENCE_ALLOWED=true` và `LRCLIB_CACHE_ALLOWED=true` khi bạn đã xác minh quyền lưu/phân phối nội dung cho mục đích của ứng dụng.

## Chế độ không có API key

Nếu chưa có API key, Lyrics Modal không tự sao chép lời từ website. Thay vào đó, nó tạo nút **Mở nguồn lời bài hát** với truy vấn đúng tên bài và ca sĩ để người dùng mở nguồn bên ngoài. Đây là fallback an toàn, không scraping và không lưu nội dung không được cấp phép.

Kiến trúc provider nằm ở `server.mjs`: provider hiện tại là Musixmatch, còn fallback link là lớp độc lập. Có thể bổ sung LyricFind hoặc một nhà cung cấp khác bằng cách thêm adapter vào `resolveLyrics()` mà không phải sửa Lyrics Modal.

LyricFind hiện công bố các sản phẩm Lyric Display và Lyric Search cho đối tác, nhưng trang chính thức yêu cầu đăng ký để được tư vấn tích hợp; chưa có endpoint công khai đủ thông tin để tự động tích hợp trong project này. Vì vậy app không giả định URL/API của LyricFind.

Sau khi thêm file, chạy lại app hoặc build lại để lời xuất hiện. Không dùng script này để crawl hàng loạt lời bài hát từ trang không cấp phép.
