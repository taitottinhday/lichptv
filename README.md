# Lịch của Vy

Bản dùng thử PWA cho lịch làm việc của Phan Thị Thảo Vy.

## Đăng nhập demo

- Tài khoản: `phanthithaovy`
- Mật khẩu: `261004`

## Chạy trên máy tính

```bash
npm run build
npm start
```

Mở `http://localhost:4173`.

Trong lúc phát triển giao diện, có thể dùng `npm run dev`.

Khi deploy Railway, Railway tự cấp biến `PORT`; `server.mjs` đã cấu hình để lắng nghe đúng cổng đó và host `0.0.0.0`.

## Dùng trên điện thoại

Điện thoại và máy tính cần cùng mạng Wi-Fi. Mở địa chỉ IP của máy tính với cổng `4173` trên điện thoại, sau đó chọn “Thêm vào màn hình chính”.

Trong app, bấm **Tải lịch vào điện thoại** để tải file `lich-cua-vy-nhac-06h-17h.ics`. Mở file bằng ứng dụng Lịch và xác nhận thêm lịch. File này tạo nhắc tự động mỗi ngày lúc **06:00** cho lịch hôm nay và **17:00** cho lịch ngày mai, kể cả khi app đã đóng.

## Thông báo trực tiếp từ app

App có thể gửi Web Push trực tiếp cho iPhone lúc **06:00** và **17:00** theo giờ Việt Nam. Trên Railway, tạo thêm một dịch vụ **PostgreSQL** trong cùng project và liên kết biến `DATABASE_URL` cho service `lichptv`.

Sau khi bấm **Bật nhắc**, app sẽ gửi ngay một thông báo chào mừng để xác nhận iPhone đã đăng ký thành công. Lịch tự động chỉ chạy ở hai mốc **06:00** và **17:00**.

### Đổi ảnh của Vy

Mở file `avatar-config.js`, thay phần `DAN_LINK_ANH_CUA_VY_VAO_DAY` bằng đường dẫn HTTPS trực tiếp tới ảnh, ví dụ:

```js
export const AVATAR_IMAGE_URL = 'https://i.imgur.com/anh-cua-vy.jpg';
```

Ảnh cần để công khai và URL phải mở thẳng ra file ảnh (`.jpg`, `.png` hoặc `.webp`), không phải đường dẫn trang Google Drive/Facebook. Sau đó chạy build và deploy lại.

Tạo cặp VAPID trên máy tính:

```bash
npx web-push generate-vapid-keys --json
```

Trong Railway → service `lichptv` → **Variables**, thêm:

- `VAPID_PUBLIC_KEY`: giá trị `publicKey` vừa tạo.
- `VAPID_PRIVATE_KEY`: giá trị `privateKey` vừa tạo.
- `VAPID_EMAIL`: ví dụ `mailto:email-cua-ban@example.com`.

Redeploy app, sau đó trên iPhone mở app từ **Màn hình chính** và bấm **Bật nhắc**. iPhone sẽ hỏi quyền thông báo; chọn **Cho phép**.

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
