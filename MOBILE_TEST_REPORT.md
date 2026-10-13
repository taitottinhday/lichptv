# Báo cáo kiểm thử mobile và karaoke

**Ngày:** 13/10/2026
**Nhánh / commit nền:** `main` / `28abef9`
**Phạm vi:** kiểm thử giao diện responsive, đồng bộ karaoke, audio riêng tư R2 và đường truy cập LAN. Thay đổi trong workspace chưa được commit.

## Phạm vi và môi trường

- Ứng dụng là PWA web dùng Vanilla JavaScript/CSS, Vite và Express (`server.mjs`), có Capacitor trong dependencies nhưng không có thư mục native `android/` hoặc `ios/`. Không phát hiện Android SDK, ADB hay emulator.
- Kiểm tra UI bằng Chromium headless với touch/mobile emulation ở 390×844, 320×640 và 844×390 CSS px. Các màn hình đã kiểm tra không tràn ngang.
- Frontend Vite nghe trên `0.0.0.0:5173`; Express nghe trên `0.0.0.0:4173`; Vite chuyển tiếp `/api` sang Express. URL LAN của máy kiểm thử: **http://172.20.10.3:5173/**. Điện thoại phải cùng mạng Wi-Fi/hotspot.
- API local chạy với R2 server-side config và không bật kết nối database/Supabase để tránh ghi dữ liệu. Không đưa khóa R2 hoặc URL ký số vào báo cáo. LRCLIB chỉ được dùng để tra lời bài hát công khai.
- Không thao tác trên tài khoản/dữ liệu production, không gửi chat hoặc thay đổi dữ liệu lịch, và không upload hay xóa audio.

## Lỗi đã xác nhận và sửa

| Ưu tiên | Tái hiện / kết quả thực tế | Sửa đổi |
| --- | --- | --- |
| P1 | Với `wordSyncLines`, lời chỉ đổi lớp màu; không phân biệt rõ từ đã hát, đang hát, sắp hát và không tô tiến độ trong thời lượng từ. | Tính trạng thái từ và phần trăm tiến độ từ timestamp thật trong `karaoke-timing.js`, đồng bộ theo `audio.currentTime`; thêm màu hồng/xanh và trạng thái rõ ràng trong `styles.css`. |
| P2 | Trên màn cảm ứng, một số nút công cụ lời và thanh tua/âm lượng nhỏ hơn vùng chạm khuyến nghị. | Tăng vùng chạm mobile, giữ bố cục responsive cho portrait và landscape. |
| P1 môi trường | Chạy frontend qua IP LAN nhưng cấu hình dev chưa chuyển tiếp API nhất quán. | Cập nhật `vite.config.js` để nghe host LAN và proxy `/api` đến Express; chỉnh lệnh dev trong `package.json` dùng config loader tương thích. |

Không xác nhận lỗi khác trong các luồng giao diện đã mở. Không thay đổi lịch, chat, đăng nhập hay dữ liệu khác.

## Thiết kế và hành vi karaoke

- Đồng bộ trực tiếp theo thời gian media. LRC có timestamp dòng thì dòng hiện tại được làm nổi bật và tự cuộn; `wordSyncLines` có timestamp từ/ngữ thì phân biệt đã hát, đang hát (tô tiến độ) và chưa hát.
- Pause giữ lời đứng yên; resume tiếp tục; seek tiến/lùi tính lại theo `currentTime`; đổi bài và đóng modal dừng audio cũ, gỡ `src` và nạp lại phần tử audio.
- Chỉ có lời văn bản thì hiển thị đầy đủ kèm trạng thái “Chỉ có lời văn bản”; không dựng timestamp. Lời LRC được gắn trạng thái đồng bộ theo dòng. Hiệu ứng từ chỉ dùng khi nguồn có timestamp từ đáng tin cậy.
- Tự cuộn dòng đang hát theo cơ chế sẵn có, chuyển màu mượt và tôn trọng `prefers-reduced-motion`.

## Kiểm thử thực tế audio và lời

- Đăng nhập phiên local trong Chromium mobile emulation, mở bài `co-khong-giu-mat-dung-tim`: API audio cấp URL tạm thời, MIME `audio/mpeg`; metadata audio nạp thành công, thời lượng trình duyệt báo 384 giây. R2 GET có `Range: bytes=0-1023` trả `206 Partial Content`, `Content-Range` và `Accept-Ranges` hợp lệ.
- Thao tác nút phát qua user gesture phát được audio R2 thật và `currentTime` tăng. Pause giữ thời gian; resume làm thời gian tăng trở lại.
- LRCLIB trả LRC thật cho bài đang thử (48 dòng nguồn; giao diện dựng 45 dòng). Tại 25,20 giây, dòng mục tiêu chưa active; phát đến 26,10 giây thì dòng đó active và nhìn thấy. Tua lùi về 21,5 giây đổi đúng về dòng trước. Seek đến 80 giây cũng chọn đúng dòng theo timestamp.
- Đổi bài khi đang phát và đóng modal: audio chuyển về pause, nguồn cũ bị gỡ và không có hai bài phát chồng. Mở bài khác nạp nguồn mới.
- Đã tra thêm `sau-tat-ca`, `mot-nha`, `noi-nay-co-anh`, `tinh-yeu-mau-nang`; các kết quả thử có timestamp theo dòng nhưng không có timestamp từng từ. Vì vậy không thể xác nhận tô từng chữ theo giọng hát cho các bài thật này. Fixture test xác minh thuật toán từ có timestamp, không đại diện lời thật.

## Thay đổi và kết quả kiểm tra lại

- `app.js`: tích hợp tính toán trạng thái karaoke theo thời gian phát.
- `karaoke-timing.js`: phân tích LRC, xác định dòng/từ đang hát và tiến độ từ timestamp.
- `styles.css`: highlight hồng/xanh, chuyển màu, hỗ trợ giảm chuyển động và vùng chạm mobile.
- `tests/karaoke-timing.test.js`: fixture hồi quy cho LRC, từ, pause/resume, seek, chuyển bài và lời văn bản thường.
- `vite.config.js`, `package.json`: cấu hình LAN và proxy API cho frontend.
- `MOBILE_TEST_REPORT.md`: báo cáo kết quả kiểm thử này.

Kết quả: `npm test` **5/5 đạt**; `git diff --check` đạt; `npx vite build --configLoader runner --outDir <thư mục tạm>` build thành công. Vite có cảnh báo một JS chunk lớn hơn 500 kB. Build được ghi vào thư mục tạm vì lần build vào `dist` trước đó bị Windows từ chối ghi đè `dist/app-icon.jpg` (`EPERM`, tệp đang bị khóa); không xóa hay sửa tệp đó.

## Truy cập bằng điện thoại và giới hạn

- Máy chủ hiện bind `0.0.0.0`; kiểm tra từ chính máy host qua IP LAN cho frontend trả HTTP 200 và `/api/health` trả `ok=true`. Express có `database=false`; audio/lyrics route nằm sau proxy nên điện thoại chỉ cần truy cập TCP 5173.
- **Chưa xác nhận được truy cập từ điện thoại thật.** Windows đang dùng firewall profile Public, inbound bị chặn và local firewall rules được quản lý bởi GPO. Quy tắc inbound giới hạn cho Node.js, TCP 5173, `LocalSubnet` không được hệ thống cho phép tạo; không thay đổi firewall rộng hoặc tắt firewall.
- Để hoàn tất kiểm tra vật lý: quản trị viên mạng/máy cần cho phép inbound TCP 5173 từ `LocalSubnet` trên Node.js bằng policy phù hợp. Sau đó mở `http://172.20.10.3:5173/` trên điện thoại cùng Wi-Fi/hotspot và thử đăng nhập, mở bài `co-khong-giu-mat-dung-tim`, phát/tạm dừng/tua. Nếu IP máy đổi, dùng IPv4 Wi-Fi mới từ `ipconfig`. Không cần mở cổng 4173 trên điện thoại vì Vite proxy API.
- Không có emulator/thiết bị thật để kiểm tra browser khác nhau, quyền media của hệ điều hành, khóa màn hình hoặc nghe nền. Chưa có dữ liệu LRCLIB word-level phù hợp để xác minh từng chữ trên bản thu thật. Không kiểm thử camera/micro, chat/cuộc gọi, lưu dữ liệu hay luồng production.

## Lưu ý bảo mật kiểm thử

Một chẩn đoán trình duyệt trong lúc kiểm tra đã vô tình ghi ra output công cụ một URL R2 ký số chỉ đọc, thời hạn 15 phút, cho một đối tượng audio. URL này không được đưa vào file báo cáo. Không có R2 access key/secret, mật khẩu hoặc token đăng nhập bị in ra. URL hết hạn khoảng 10:51 UTC ngày 13/10/2026; đây không phải URL công khai lâu dài và không cho phép ghi/xóa.
