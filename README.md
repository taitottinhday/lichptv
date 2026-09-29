# Lịch của Vy

Bản dùng thử PWA cho lịch làm việc của Phan Thị Thảo Vy.

## Đăng nhập demo

- Tài khoản: `phanthithaovy`
- Mật khẩu: `261004`

## Chạy trên máy tính

```bash
npm start
```

Mở `http://localhost:4173`.

Khi deploy Railway, Railway tự cấp biến `PORT`; `server.mjs` đã cấu hình để lắng nghe đúng cổng đó và host `0.0.0.0`.

## Dùng trên điện thoại

Điện thoại và máy tính cần cùng mạng Wi-Fi. Mở địa chỉ IP của máy tính với cổng `4173` trên điện thoại, sau đó chọn “Thêm vào màn hình chính”.

Trong app, bấm **Tải lịch vào điện thoại** để tải file `lich-cua-vy-nhac-06h-17h.ics`. Mở file bằng ứng dụng Lịch và xác nhận thêm lịch. File này tạo nhắc tự động mỗi ngày lúc **06:00** cho lịch hôm nay và **17:00** cho lịch ngày mai, kể cả khi app đã đóng.

## Đóng gói thành app iPhone có thông báo native

Để app nhắc lúc 06:00 và 17:00 kể cả khi đã đóng, cần build bằng **macOS + Xcode**. Windows không thể xuất hoặc ký file iOS `.ipa`.

```bash
npm install
npm run build
npx cap add ios
npm run cap:sync
npm run ios
```

Trong Xcode, chọn iPhone của bạn làm thiết bị chạy, bật **Signing & Capabilities**, chọn Apple Developer Team rồi bấm **Run**. Lần đầu cần cấp quyền thông báo trên iPhone.

Sau khi bấm nút **Bật nhắc** trong app, app sẽ lập thông báo cục bộ:

- 06:00: lịch hôm nay của Vy.
- 17:00: lịch ngày mai của Vy.

> Lưu ý: tài khoản demo đang được kiểm tra ở phía giao diện để dùng thử. Khi đưa lên Internet hoặc dùng thật, cần chuyển xác thực sang máy chủ và lưu mật khẩu dạng hash.
