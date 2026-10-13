#!/usr/bin/env python3
"""Create word-level karaoke timing JSON from locally supplied vocal audio.

The script reads the authoritative song IDs from karaoke-data.js using Node,
then uses local audio named <songId>.<extension>. It never downloads audio.
Forced alignment requires a vocal/guide-vocal recording; an instrumental beat
does not contain the speech signal needed to align lyrics.
"""

from __future__ import annotations

import argparse
import difflib
import json
import math
import re
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Any


SUPPORTED_AUDIO = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus"}
LRC_TIMESTAMP = re.compile(r"\[(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]")
BRACKETED_METADATA = re.compile(r"\[(?:ar|ti|al|by|re|ve|length|offset|kana|la|la)\s*:[^\]]*\]", re.I)
WORD_TOKEN = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)


def project_songs(project_root: Path) -> list[dict[str, str]]:
    """Load actual exported song metadata rather than parsing JS with regex."""
    js = (
        "import { UNIQUE_KARAOKE_SONGS } from './karaoke-data.js';"
        " console.log(JSON.stringify(UNIQUE_KARAOKE_SONGS.map(({title,songId})=>({title,songId}))));"
    )
    try:
        result = subprocess.run(
            ["node", "--input-type=module", "--eval", js],
            cwd=project_root,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Không tìm thấy Node.js; hãy cài Node.js rồi chạy lại pipeline.") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        raise RuntimeError(f"Không đọc được karaoke-data.js: {detail}") from exc

    songs = json.loads(result.stdout)
    if not isinstance(songs, list):
        raise RuntimeError("UNIQUE_KARAOKE_SONGS không trả về danh sách hợp lệ.")
    return [
        {"title": str(song["title"]), "songId": str(song["songId"])}
        for song in songs
        if song.get("title") and song.get("songId")
    ]


def resolve_audio(audio_dir: Path, song_id: str) -> Path | None:
    matches = sorted(
        path for path in audio_dir.glob(f"{song_id}.*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_AUDIO
    )
    if len(matches) > 1:
        raise RuntimeError(
            f"Có nhiều audio cho {song_id}: "
            + ", ".join(path.name for path in matches)
            + ". Hãy chỉ giữ một file đúng phiên bản."
        )
    return matches[0] if matches else None


def read_static_lyrics(lyrics_dir: Path, song_id: str) -> list[str]:
    """Read UTF-8 plain text (or LRC text), preserving its line boundaries."""
    candidates = [lyrics_dir / f"{song_id}.txt", lyrics_dir / f"{song_id}.lrc"]
    source = next((path for path in candidates if path.is_file()), None)
    if source is None:
        return []

    lines: list[str] = []
    for raw_line in source.read_text(encoding="utf-8-sig").splitlines():
        line = LRC_TIMESTAMP.sub("", raw_line)
        line = BRACKETED_METADATA.sub("", line).strip()
        if line and not line.startswith("#"):
            lines.append(line)
    return lines


def normalized_tokens(text: str) -> list[str]:
    text = unicodedata.normalize("NFD", text.lower().replace("đ", "d").replace("Đ", "D"))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return [token.casefold() for token in WORD_TOKEN.findall(text)]


def lyric_match_ratio(lyrics: str, transcript: str) -> float:
    expected = normalized_tokens(lyrics)
    heard = normalized_tokens(transcript)
    if not expected or not heard:
        return 0.0
    return difflib.SequenceMatcher(a=expected, b=heard, autojunk=False).ratio()


def finite_seconds(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def ms(value: Any) -> int | None:
    seconds = finite_seconds(value)
    return round(seconds * 1000) if seconds is not None else None


def sentence_rows(aligned: dict[str, Any]) -> tuple[list[dict[str, Any]], int, int]:
    rows: list[dict[str, Any]] = []
    timed_count = 0
    total_count = 0

    for segment in aligned.get("segments", []):
        output_words = []
        for word in segment.get("words", []):
            text = str(word.get("word", "")).strip()
            if not text:
                continue
            start = ms(word.get("start"))
            end = ms(word.get("end"))
            total_count += 1
            if start is not None and end is not None and end >= start:
                timed_count += 1
            else:
                # Preserve unaligned text, but never invent a time for it.
                start = end = None
            output_word: dict[str, Any] = {
                "startTime": start,
                "endTime": end,
                "data": text,
            }
            score = word.get("score")
            if isinstance(score, (int, float)) and math.isfinite(float(score)):
                output_word["alignmentScore"] = round(float(score), 3)
            output_words.append(output_word)

        if not output_words:
            continue
        valid_starts = [word["startTime"] for word in output_words if word["startTime"] is not None]
        valid_ends = [word["endTime"] for word in output_words if word["endTime"] is not None]
        rows.append({
            "startTime": min(valid_starts) if valid_starts else None,
            "endTime": max(valid_ends) if valid_ends else None,
            "text": str(segment.get("text", "")).strip(),
            "words": output_words,
        })

    return rows, timed_count, total_count


def atomic_json_write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Căn lời theo vocal audio có sẵn; không tải audio từ Internet."
    )
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--audio-dir", type=Path, default=Path("downloads/audios"))
    parser.add_argument("--lyrics-dir", type=Path, default=Path("public/lyrics"))
    parser.add_argument("--output-dir", type=Path, default=Path("downloads/json"))
    parser.add_argument("--model", default="small", help="WhisperX model, ví dụ small hoặc medium")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--compute-type", default="int8", help="Mặc định int8 phù hợp CPU")
    parser.add_argument("--language", default="auto", help="Mã ngôn ngữ WhisperX, mặc định auto")
    parser.add_argument("--align-model", default=None, help="Tên model alignment tùy chọn cho ngôn ngữ ít phổ biến")
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--list-only", action="store_true", help="Liệt kê songId và audio đã ghép, không chạy AI")
    parser.add_argument(
        "--min-lyric-match", type=float, default=0.30,
        help="Ngưỡng so khớp ASR với lời tĩnh; thấp hơn thì không ép căn và cần xem lại.",
    )
    parser.add_argument("--force", action="store_true", help="Ghi đè JSON đã có")
    parser.add_argument("--include-missing", action="store_true", help="Tạo JSON trạng thái missing_audio")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.project_root.resolve()
    audio_dir = (root / args.audio_dir).resolve() if not args.audio_dir.is_absolute() else args.audio_dir
    lyrics_dir = (root / args.lyrics_dir).resolve() if not args.lyrics_dir.is_absolute() else args.lyrics_dir
    output_dir = (root / args.output_dir).resolve() if not args.output_dir.is_absolute() else args.output_dir

    if not (root / "karaoke-data.js").is_file():
        print(f"Không thấy karaoke-data.js trong {root}", file=sys.stderr)
        return 2
    if not 0 <= args.min_lyric_match <= 1:
        print("--min-lyric-match phải nằm trong khoảng 0..1", file=sys.stderr)
        return 2

    try:
        songs = project_songs(root)
    except (RuntimeError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2

    audio_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Bài trong karaoke-data.js: {len(songs)}")
    print(f"Audio cần đặt tại: {audio_dir}\\<songId>.<đuôi>")
    if args.list_only:
        matched = 0
        for song in songs:
            try:
                audio_path = resolve_audio(audio_dir, song["songId"])
            except RuntimeError as exc:
                print(f"LỖI {song['songId']}: {exc}")
                continue
            if audio_path:
                matched += 1
                print(f"CÓ AUDIO  {song['songId']}  {audio_path.name}")
        print(f"Đã ghép {matched}/{len(songs)} bài. Chưa chạy nhận dạng hoặc alignment.")
        return 0
    if args.list_only:
        matched = 0
        for song in songs:
            try:
                audio_path = resolve_audio(audio_dir, song["songId"])
            except RuntimeError as exc:
                print(f"LỖI {song['songId']}: {exc}")
                continue
            if audio_path:
                matched += 1
                print(f"CÓ AUDIO  {song['songId']}  {audio_path.name}")
        print(f"Đã ghép {matched}/{len(songs)} bài. Chưa chạy nhận dạng hoặc alignment.")
        return 0

    whisperx = None
    model = None
    device = args.device
    align_model_cache: dict[str, tuple[Any, dict[str, Any]]] = {}

    for index, song in enumerate(songs, start=1):
        song_id = song["songId"]
        output_path = output_dir / f"{song_id}.json"
        try:
            audio_path = resolve_audio(audio_dir, song_id)
        except RuntimeError as exc:
            print(f"[{index}/{len(songs)}] LỖI {song['title']}: {exc}")
            continue

        if audio_path is None:
            print(f"[{index}/{len(songs)}] BỎ QUA, chưa có audio: {song['title']} ({song_id})")
            if args.include_missing and (args.force or not output_path.exists()):
                atomic_json_write(output_path, {
                    "title": song["title"], "songId": song_id,
                    "status": "missing_audio", "sentences": [],
                    "warnings": ["Chưa có audio local được ghép theo songId."],
                })
            continue

        if output_path.exists() and not args.force:
            try:
                old = json.loads(output_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                old = {}
            if old.get("status") == "success":
                print(f"[{index}/{len(songs)}] ĐÃ CÓ, bỏ qua: {song['title']}")
                continue

        lyric_lines = read_static_lyrics(lyrics_dir, song_id)
        lyric_text = " ".join(
            line if line[-1:] in ".!?;:" else f"{line}."
            for line in lyric_lines
        )
        result_doc: dict[str, Any] = {
            "schemaVersion": 1,
            "title": song["title"],
            "songId": song_id,
            "status": "failed",
            "audioFile": audio_path.name,
            "language": None,
            "timingSource": "whisperx_forced_alignment",
            "reviewRequired": True,
            "sentences": [],
            "warnings": [],
        }

        try:
            if whisperx is None:
                try:
                    import whisperx as whisperx_module
                except ImportError as exc:
                    raise RuntimeError(
                        "Thiếu WhisperX. Cài bằng `python -m pip install -r requirements.txt`."
                    ) from exc
                whisperx = whisperx_module
                if device == "auto":
                    import torch
                    device = "cuda" if torch.cuda.is_available() else "cpu"
                model = whisperx.load_model(
                    args.model,
                    device,
                    compute_type=args.compute_type,
                )

            audio = whisperx.load_audio(str(audio_path))
            transcription = model.transcribe(
                audio,
                batch_size=args.batch_size,
                language=None if args.language.casefold() == "auto" else args.language,
            )
            language = args.language if args.language.casefold() != "auto" else transcription.get("language")
            result_doc["language"] = language
            transcript_segments = transcription.get("segments", [])
            transcript_text = " ".join(str(segment.get("text", "")) for segment in transcript_segments)

            if lyric_text:
                similarity = lyric_match_ratio(lyric_text, transcript_text)
                result_doc["lyricTranscriptMatch"] = round(similarity, 3)
                if similarity < args.min_lyric_match:
                    result_doc["status"] = "needs_review"
                    result_doc["warnings"].append(
                        "ASR không khớp đủ với lời tĩnh. Có thể audio là beat không vocal, sai phiên bản, "
                        "hoặc nhận dạng giọng hát kém; pipeline không ép căn để tránh tạo mốc giả."
                    )
                    result_doc["transcriptPreview"] = transcript_text[:500]
                    atomic_json_write(output_path, result_doc)
                    print(f"[{index}/{len(songs)}] CẦN XEM LẠI (không khớp lời): {song['title']}")
                    continue
                alignment_segments = [{
                    "start": 0.0,
                    "end": len(audio) / 16000,
                    "text": lyric_text,
                }]
                result_doc["lyricsSource"] = str(
                    (lyrics_dir / f"{song_id}.txt").name
                    if (lyrics_dir / f"{song_id}.txt").is_file()
                    else f"{song_id}.lrc"
                )
                result_doc["timingSource"] = "whisperx_forced_alignment_static_lyrics"
            else:
                if not transcript_text.strip():
                    result_doc["status"] = "needs_review"
                    result_doc["warnings"].append(
                        "Whisper không nhận ra vocal có thể căn. Beat/instrumental không thể tạo timestamp lời."
                    )
                    atomic_json_write(output_path, result_doc)
                    print(f"[{index}/{len(songs)}] CẦN XEM LẠI (không nhận ra lời): {song['title']}")
                    continue
                alignment_segments = transcript_segments
                result_doc["timingSource"] = "whisperx_transcription_then_alignment"
                result_doc["warnings"].append(
                    "Lời do ASR nhận dạng; hãy đối chiếu nội dung trước khi dùng."
                )

            if language not in align_model_cache:
                align_model_cache[language] = whisperx.load_align_model(
                    language_code=language,
                    device=device,
                    model_name=args.align_model,
                )
            align_model, align_metadata = align_model_cache[language]
            aligned = whisperx.align(
                alignment_segments,
                align_model,
                align_metadata,
                audio,
                device,
                interpolate_method="ignore",
                return_char_alignments=False,
            )
            sentences, timed_words, all_words = sentence_rows(aligned)
            coverage = timed_words / all_words if all_words else 0.0
            result_doc["sentences"] = sentences
            result_doc["wordTimingCoverage"] = round(coverage, 3)
            result_doc["wordCount"] = all_words
            result_doc["timedWordCount"] = timed_words

            if not sentences or not timed_words:
                result_doc["status"] = "needs_review"
                result_doc["warnings"].append("Không có từ nào được căn với timestamp đáng tin cậy.")
            elif coverage < 0.80:
                result_doc["status"] = "partial"
                result_doc["warnings"].append(
                    "Một số từ không được căn; timestamp của chúng để null, không nội suy."
                )
            elif not lyric_text:
                result_doc["status"] = "needs_review"
                result_doc["warnings"].append(
                    "Có timestamp cho transcript, nhưng cần người nghe duyệt lời do ASR sinh ra."
                )
            else:
                result_doc["status"] = "success"
                result_doc["reviewRequired"] = True
                result_doc["warnings"].append(
                    "Đã căn lời tĩnh với vocal audio. Cần nghe duyệt vì nhạc nền, bè và khác biệt phiên bản có thể làm lệch mốc."
                )

            atomic_json_write(output_path, result_doc)
            print(
                f"[{index}/{len(songs)}] {result_doc['status'].upper()}: {song['title']} "
                f"({timed_words}/{all_words} từ có mốc) -> {output_path.name}"
            )
        except Exception as exc:  # Keep the batch moving; write a per-song error record.
            result_doc["status"] = "failed"
            result_doc["warnings"].append(f"{type(exc).__name__}: {exc}")
            atomic_json_write(output_path, result_doc)
            print(f"[{index}/{len(songs)}] LỖI {song['title']}: {type(exc).__name__}: {exc}")

    print(f"\nHoàn tất. JSON nằm trong: {output_dir}")
    print("Kiểm tra status và nghe duyệt trước khi đưa timestamp vào ứng dụng.")
    return 0


if __name__ == "__main__":
    # Avoid UnicodeEncodeError in older Windows terminals with a legacy code page.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
