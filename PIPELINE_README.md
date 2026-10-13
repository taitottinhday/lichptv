# Căn lời karaoke bằng audio local

`pipeline.py` đọc danh sách và `songId` thật từ `karaoke-data.js`, tìm lời hiện có trong `public/lyrics/`, rồi tạo JSON word timing trong `downloads/json/`.

## Audio cần có vocal

Forced alignment cần nghe được giọng hát. Một instrumental/karaoke beat không có vocal thì không thể chỉ ra lúc nào từng từ được hát. Hãy dùng bản thu vocal, guide vocal hoặc vocal stem mà bạn có quyền xử lý. Script này không tìm kiếm hay tải nhạc từ YouTube hoặc website khác.

Đặt một audio cho mỗi bài theo tên `songId`:

```text
downloads/audios/co-khong-giu-mat-dung-tim.mp3
downloads/audios/noi-nay-co-anh.wav
```

Định dạng hỗ trợ: MP3, WAV, FLAC, M4A, AAC, OGG và OPUS. Nếu một bài có nhiều bản, chỉ giữ một file có đúng phiên bản vocal. Không dùng tên hiển thị để ghép audio.

## Cài trên VS Code / Windows

1. Cài Node.js (project đã dùng Node để đọc module `karaoke-data.js`) và Python 3.10 hoặc 3.11.
2. Cài FFmpeg và đảm bảo `ffmpeg -version` chạy được trong terminal. WhisperX dùng FFmpeg để đọc các định dạng audio.
3. Mở terminal tại thư mục `lichptv`, tạo môi trường ảo và cài package:

```powershell
py -3.11 -m venv .venv-align
Set-ExecutionPolicy -Scope Process Bypass
.\.venv-align\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

WhisperX/PyTorch khá nặng. Nên cài trong môi trường ảo riêng `.venv-align`, không cài vào Python dùng chung: WhisperX có thể thay phiên bản `torch`, `transformers` và `huggingface-hub` mà ứng dụng Python khác đang cần. CPU chạy được nhưng chậm; nếu muốn dùng GPU, cài đúng bản PyTorch/CUDA theo hướng dẫn WhisperX trước.

## Chạy

```powershell
New-Item -ItemType Directory -Force downloads\audios | Out-Null
python pipeline.py --audio-dir downloads/audios --lyrics-dir public/lyrics --output-dir downloads/json
```

Trước khi tải model hoặc chạy cả batch, có thể xem các bài nào ghép được audio:

```powershell
python pipeline.py --list-only
```

Lần đầu chạy AI sẽ tải model WhisperX về cache máy. Có thể mất thời gian và cần dung lượng trống; không đóng terminal khi tiến trình tải còn chạy. Chạy CPU rõ ràng bằng `python pipeline.py --device cpu --compute-type int8`.

Mặc định dùng model `small`, tự nhận diện ngôn ngữ và ưu tiên `int8` cho CPU. Có thể chọn:

```powershell
python pipeline.py --model medium --device cuda --compute-type float16
python pipeline.py --language vi --model small
python pipeline.py --force
python pipeline.py --include-missing
```

- Bài không có audio đúng tên `songId` sẽ được bỏ qua. `--include-missing` ghi JSON trạng thái `missing_audio` để tiện kiểm tra danh sách.
- JSON trạng thái `success` cũng cần nghe duyệt trước khi đưa vào app; trạng thái `partial`, `needs_review` và `failed` không nên coi là timestamp đã xác minh.
- Khi lời tĩnh không khớp transcript audio đủ mức, script không ép căn mà lưu `needs_review`. Điều này giúp tránh căn nhầm phiên bản hoặc sinh mốc cho beat không vocal.
- Từ Whisper không căn được giữ `startTime`/`endTime` là `null`; script không nội suy timestamp giả. Nếu không có lời tĩnh, transcript ASR cũng cần người duyệt.
- Kết quả nằm tại `downloads/json/<songId>.json`, mỗi từ có `startTime`, `endTime` theo milliseconds và `data`.

## Khắc phục lỗi cài đặt và chạy

- `BỎ QUA, chưa có audio` là trạng thái bình thường cho bài chưa có file `downloads/audios/<songId>.<đuôi>`; pipeline bỏ riêng bài đó và tiếp tục. Cần đặt bản thu có vocal đúng bài theo `songId` để xử lý. Beat instrumental không thể căn lời hát.
- Trước đây WhisperX được import bên trong vòng lặp từng bài, nên thiếu package làm hàng loạt dòng `LỖI ... Thiếu WhisperX`. Giờ pipeline kiểm tra FFmpeg và nạp WhisperX/model một lần trước khi xử lý; thiếu dependency sẽ dừng sớm với một thông báo chung thay vì ghi 350 lỗi JSON.
- Nếu đã cài WhisperX vào Python toàn cục và pip báo xung đột với `sentence-transformers`, không tiếp tục thay đổi Python toàn cục. Tạo venv theo các lệnh cài ở trên, kích hoạt venv rồi cài `requirements.txt` trong đó. Sau đó luôn chạy `python pipeline.py` từ chính terminal đã kích hoạt venv.
- Cảnh báo Hugging Face về symlink/hardlink trên Windows thường chỉ nói cache sẽ tốn thêm dung lượng; tự nó không làm hỏng model. `model.bin 0%` là tiến trình tải model, chưa đủ để kết luận bị treo; hãy chờ hoặc kiểm tra kết nối/dung lượng nếu không tiến triển lâu.
- Một số bản WhisperX/Pyannote có thể in cảnh báo TorchCodec khi FFmpeg DLL không tương thích. Pipeline này đọc audio qua FFmpeg CLI; kiểm tra bằng `ffmpeg -version`. Nếu FFmpeg CLI chạy được, cảnh báo TorchCodec không tự nó chứng minh audio decoder của pipeline bị lỗi. Nếu pipeline báo không tìm thấy FFmpeg, cài FFmpeg hoặc truyền `--ffmpeg <đường-dẫn-ffmpeg.exe>`.

Ví dụ lệnh kiểm tra bài có audio:

```powershell
python pipeline.py --audio-dir downloads/audios --output-dir downloads/json --language vi
Get-Content -Encoding utf8 downloads\json\co-khong-giu-mat-dung-tim.json
```

## Giới hạn

WhisperX dùng mô hình alignment theo ngôn ngữ và giọng hát, nhạc nền, bè hoặc phiên bản khác lời đều có thể làm lệch kết quả. “Success” nghĩa là các từ đã được bộ align gán mốc theo dữ liệu; vẫn cần nghe đối chiếu. Lời do ASR tự tạo luôn được đánh dấu cần duyệt. Không chạy alignment trên instrumental nếu mục tiêu là đồng bộ lời ca sĩ.

## Nguồn kỹ thuật

- WhisperX mô tả word-level timing bằng forced phoneme alignment và hỗ trợ Python API `load_align_model` / `align`: [README chính thức](https://github.com/m-bain/whisperX#python-usage).
- Mô hình alignment phụ thuộc ngôn ngữ; danh sách mặc định hiện có mã `vi`: [alignment.py chính thức](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py).
- Whisper gốc chỉ cho timestamp ở mức câu/đoạn; dùng alignment riêng để có word timing: [Whisper README](https://github.com/openai/whisper#setup).
