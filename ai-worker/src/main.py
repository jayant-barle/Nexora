#!/usr/bin/env python3
# ============================================================================
# Nexora — Python AI Worker Subprocess (Production Engine)
# Local inference: Face detection, clustering, perceptual hashing,
# metadata extraction, video keyframe sampling, and thumbnail generation.
# Zero-cloud, local-first JSON-RPC server over standard input/output.
# ============================================================================

import sys
import os
import json
import hashlib
import traceback
import struct
from typing import Dict, Any, List, Optional, Tuple

# Attempt imports with graceful fallbacks
try:
    import cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    # pyrefly: ignore[missing-import]
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


# ─── Native Pure-Python EXIF & Media Parsers ─────────────────────────────────

def parse_jpeg_exif(file_path: str) -> Dict[str, Any]:
    """Extract EXIF metadata (Date, Make, Model, Lens, GPS, Technical) without external libraries."""
    result: Dict[str, Any] = {
        "capture_time": None,
        "camera_make": None,
        "camera_model": None,
        "lens_model": None,
        "orientation": None,
        "iso": None,
        "focal_length": None,
        "aperture": None,
        "exposure_time": None,
        "has_gps": False,
        "latitude": None,
        "longitude": None,
        "altitude": None,
    }

    try:
        with open(file_path, "rb") as f:
            header = f.read(2)
            if header != b"\xff\xd8":
                return result  # Not a valid JPEG

            while True:
                marker = f.read(2)
                if len(marker) < 2 or marker[0] != 0xFF:
                    break
                if marker[1] in (0xD9, 0xDA):  # EOI or SOS
                    break

                length_bytes = f.read(2)
                if len(length_bytes) < 2:
                    break
                length = struct.unpack(">H", length_bytes)[0]
                if length < 2:
                    break

                segment_data = f.read(length - 2)

                # APP1 marker (0xFFE1) contains EXIF
                if marker[1] == 0xE1 and segment_data.startswith(b"Exif\x00\x00"):
                    tiff_data = segment_data[6:]
                    if len(tiff_data) < 8:
                        continue

                    endian_marker = tiff_data[:2]
                    if endian_marker == b"II":
                        byte_order = "<"
                    elif endian_marker == b"MM":
                        byte_order = ">"
                    else:
                        continue

                    first_ifd_offset = struct.unpack(f"{byte_order}I", tiff_data[4:8])[0]
                    if first_ifd_offset >= len(tiff_data):
                        continue

                    def read_ifd(offset: int) -> Dict[int, Any]:
                        entries: Dict[int, Any] = {}
                        if offset + 2 > len(tiff_data):
                            return entries
                        num_entries = struct.unpack(f"{byte_order}H", tiff_data[offset:offset + 2])[0]
                        pos = offset + 2

                        for _ in range(num_entries):
                            if pos + 12 > len(tiff_data):
                                break
                            tag, tag_type, count, val_or_offset = struct.unpack(f"{byte_order}HHI I", tiff_data[pos:pos + 12])
                            pos += 12

                            try:
                                # String type (type 2)
                                if tag_type == 2:
                                    if count <= 4:
                                        val_bytes = struct.pack(f"{byte_order}I", val_or_offset)[:count]
                                    else:
                                        val_bytes = tiff_data[val_or_offset:val_or_offset + count]
                                    entries[tag] = val_bytes.decode("ascii", errors="ignore").rstrip("\x00").strip()
                                # Short (type 3)
                                elif tag_type == 3:
                                    entries[tag] = val_or_offset & 0xFFFF
                                # Long (type 4)
                                elif tag_type == 4:
                                    entries[tag] = val_or_offset
                                # Rational (type 5)
                                elif tag_type == 5:
                                    if val_or_offset + 8 <= len(tiff_data):
                                        num, den = struct.unpack(f"{byte_order}II", tiff_data[val_or_offset:val_or_offset + 8])
                                        entries[tag] = (num / den) if den != 0 else float(num)
                                else:
                                    entries[tag] = val_or_offset
                            except Exception:
                                pass

                        return entries

                    ifd0 = read_ifd(first_ifd_offset)
                    if 0x010F in ifd0 and isinstance(ifd0[0x010F], str):
                        result["camera_make"] = ifd0[0x010F].strip()
                    if 0x0110 in ifd0 and isinstance(ifd0[0x0110], str):
                        result["camera_model"] = ifd0[0x0110].strip()
                    if 0x0112 in ifd0 and isinstance(ifd0[0x0112], int):
                        result["orientation"] = ifd0[0x0112]

                    # Exif SubIFD (tag 0x8769)
                    if 0x8769 in ifd0:
                        exif_ifd = read_ifd(ifd0[0x8769])
                        date_str = exif_ifd.get(0x9003) or exif_ifd.get(0x9004) or ifd0.get(0x0132)
                        if isinstance(date_str, str) and len(date_str) >= 19:
                            try:
                                parts = date_str.split(" ")
                                ymd = parts[0].replace(":", "-")
                                result["capture_time"] = f"{ymd}T{parts[1]}"
                            except Exception:
                                result["capture_time"] = date_str

                        if 0x8827 in exif_ifd and isinstance(exif_ifd[0x8827], int):
                            result["iso"] = exif_ifd[0x8827]
                        if 0x829D in exif_ifd and isinstance(exif_ifd[0x829D], (int, float)):
                            result["aperture"] = round(float(exif_ifd[0x829D]), 2)
                        if 0x920A in exif_ifd and isinstance(exif_ifd[0x920A], (int, float)):
                            result["focal_length"] = round(float(exif_ifd[0x920A]), 1)
                        if 0x829A in exif_ifd:
                            val = exif_ifd[0x829A]
                            if isinstance(val, float) and val > 0:
                                result["exposure_time"] = f"1/{round(1.0 / val)}" if val < 1 else str(round(val, 2))
                            elif isinstance(val, str):
                                result["exposure_time"] = val
                        if 0xA434 in exif_ifd and isinstance(exif_ifd[0xA434], str):
                            result["lens_model"] = exif_ifd[0xA434].strip()
                        if 0xA001 in exif_ifd and isinstance(exif_ifd[0xA001], int):
                            cs = exif_ifd[0xA001]
                            result["color_profile"] = "sRGB" if cs == 1 else ("Adobe RGB" if cs == 2 else "Uncalibrated")

                    # GPS IFD (tag 0x8825)
                    if 0x8825 in ifd0:
                        gps_ifd = read_ifd(ifd0[0x8825])
                        lat_ref = gps_ifd.get(1)  # 'N' or 'S'
                        lon_ref = gps_ifd.get(3)  # 'E' or 'W'
                        alt = gps_ifd.get(6)      # Altitude
                        if isinstance(alt, (int, float)):
                            result["altitude"] = round(float(alt), 1)

                        # GPS lat/lon rationals (degrees, minutes, seconds)
                        def parse_gps_coord(coord_offset: int) -> Optional[float]:
                            if coord_offset + 24 <= len(tiff_data):
                                try:
                                    d_num, d_den, m_num, m_den, s_num, s_den = struct.unpack(
                                        f"{byte_order}IIIIII", tiff_data[coord_offset:coord_offset + 24]
                                    )
                                    deg = d_num / d_den if d_den else 0
                                    minute = m_num / m_den if m_den else 0
                                    sec = s_num / s_den if s_den else 0
                                    return deg + (minute / 60.0) + (sec / 3600.0)
                                except Exception:
                                    return None
                            return None

                        raw_lat_offset = ifd0.get(0x8825)
                        # Read raw coords if present
                        if 2 in gps_ifd and isinstance(gps_ifd[2], int):
                            lat = parse_gps_coord(gps_ifd[2])
                            if lat is not None:
                                if isinstance(lat_ref, str) and lat_ref.upper() == "S":
                                    lat = -lat
                                result["latitude"] = round(lat, 6)
                                result["has_gps"] = True

                        if 4 in gps_ifd and isinstance(gps_ifd[4], int):
                            lon = parse_gps_coord(gps_ifd[4])
                            if lon is not None:
                                if isinstance(lon_ref, str) and lon_ref.upper() == "W":
                                    lon = -lon
                                result["longitude"] = round(lon, 6)
                                result["has_gps"] = True
                    break
    except Exception:
        pass

    return result


def parse_pdf_metadata(file_path: str) -> Dict[str, Any]:
    """Parse PDF page count, metadata dictionary, and text preview without executing contents."""
    res = {
        "page_count": None,
        "doc_title": None,
        "doc_author": None,
        "doc_subject": None,
        "text_preview": None,
        "status": "ok",
        "error": None,
    }

    try:
        size = os.path.getsize(file_path)
        if size == 0:
            res["status"] = "corrupt"
            res["error"] = "Zero-byte PDF file"
            return res

        # Read first 1MB of PDF for structural inspection
        read_len = min(size, 1024 * 1024)
        with open(file_path, "rb") as f:
            data = f.read(read_len)

        if not data.startswith(b"%PDF-"):
            res["status"] = "corrupt"
            res["error"] = "Invalid PDF magic header"
            return res

        if b"/Encrypt" in data:
            res["status"] = "encrypted"
            res["error"] = "Encrypted or password-protected PDF"

        text_content = data.decode("latin-1", errors="ignore")

        # Find /Title, /Author, /Subject
        import re
        title_match = re.search(r"/Title\s*\(([^)]+)\)", text_content)
        if title_match:
            res["doc_title"] = title_match.group(1).strip()

        author_match = re.search(r"/Author\s*\(([^)]+)\)", text_content)
        if author_match:
            res["doc_author"] = author_match.group(1).strip()

        subject_match = re.search(r"/Subject\s*\(([^)]+)\)", text_content)
        if subject_match:
            res["doc_subject"] = subject_match.group(1).strip()

        # Page count via /Type /Pages /Count N or counting /Type /Page
        count_match = re.search(r"/Type\s*/Pages.*?/Count\s+(\d+)", text_content, re.DOTALL)
        if count_match:
            res["page_count"] = int(count_match.group(1))
        else:
            page_matches = len(re.findall(r"/Type\s*/Page\b", text_content))
            if page_matches > 0:
                res["page_count"] = page_matches

        # Extract textual fragments from stream segments
        stream_chunks = re.findall(r"\(([^)]{3,})\)", text_content)
        if stream_chunks:
            sample_text = " ".join([c for c in stream_chunks if not re.match(r"^[\x00-\x1f]+$", c)])
            res["text_preview"] = sample_text[:3000].strip() or None

    except Exception as e:
        res["status"] = "corrupt"
        res["error"] = str(e)

    return res


def parse_office_metadata(file_path: str, ext: str) -> Dict[str, Any]:
    """Parse DOCX, PPTX, and XLSX properties and word counts via pure zipfile and XML parsing."""
    import zipfile
    import xml.etree.ElementTree as ET

    res = {
        "doc_title": None,
        "doc_author": None,
        "doc_subject": None,
        "page_count": None,
        "word_count": None,
        "capture_time": None,
        "text_preview": None,
        "status": "ok",
        "error": None,
    }

    try:
        if not zipfile.is_zipfile(file_path):
            res["status"] = "corrupt"
            res["error"] = f"Corrupted or invalid {ext.upper()} archive container"
            return res

        with zipfile.ZipFile(file_path, "r") as z:
            # Check docProps/core.xml for Dublin Core properties
            if "docProps/core.xml" in z.namelist():
                try:
                    core_xml = z.read("docProps/core.xml")
                    root = ET.fromstring(core_xml)
                    for elem in root.iter():
                        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                        if tag == "title" and elem.text:
                            res["doc_title"] = elem.text.strip()
                        elif tag == "creator" and elem.text:
                            res["doc_author"] = elem.text.strip()
                        elif tag == "subject" and elem.text:
                            res["doc_subject"] = elem.text.strip()
                        elif tag == "description" and elem.text and not res.get("doc_subject"):
                            res["doc_subject"] = elem.text.strip()
                        elif tag == "created" and elem.text:
                            res["capture_time"] = elem.text.strip()
                except Exception:
                    pass

            # Check docProps/app.xml for pages and words
            if "docProps/app.xml" in z.namelist():
                try:
                    app_xml = z.read("docProps/app.xml")
                    root = ET.fromstring(app_xml)
                    for elem in root.iter():
                        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                        if tag == "Pages" and elem.text:
                            res["page_count"] = int(elem.text.strip())
                        elif tag == "Words" and elem.text:
                            res["word_count"] = int(elem.text.strip())
                except Exception:
                    pass

            # Extract sample text for DOCX
            if ext == ".docx" and "word/document.xml" in z.namelist():
                try:
                    doc_xml = z.read("word/document.xml")
                    root = ET.fromstring(doc_xml)
                    texts = []
                    for elem in root.iter():
                        if elem.tag.endswith("t") and elem.text:
                            texts.append(elem.text)
                            if len(texts) > 200:
                                break
                    if texts:
                        res["text_preview"] = " ".join(texts)[:3000].strip()
                except Exception:
                    pass

    except zipfile.BadZipFile:
        res["status"] = "corrupt"
        res["error"] = "Damaged or invalid ZIP container"
    except Exception as e:
        res["status"] = "corrupt"
        res["error"] = str(e)

    return res


def parse_audio_metadata(file_path: str, ext: str) -> Dict[str, Any]:
    """Extract audio duration, artist, album, title, and bitrate using native binary parsing."""
    res = {
        "duration_seconds": None,
        "audio_artist": None,
        "audio_album": None,
        "audio_title": None,
        "bitrate": None,
        "status": "ok",
        "error": None,
    }

    try:
        file_size = os.path.getsize(file_path)
        if file_size < 12:
            res["status"] = "corrupt"
            res["error"] = "Audio file too small"
            return res

        with open(file_path, "rb") as f:
            header = f.read(1024)

        # ── WAV File Parsing ─────────────────────────────────────────────────
        if ext == ".wav" and header[:4] == b"RIFF" and header[8:12] == b"WAVE":
            pos = 12
            while pos + 8 <= len(header):
                chunk_id = header[pos:pos + 4]
                chunk_size = struct.unpack("<I", header[pos + 4:pos + 8])[0]
                if chunk_id == b"fmt " and pos + 8 + chunk_size <= len(header):
                    fmt_data = header[pos + 8:pos + 8 + chunk_size]
                    channels = struct.unpack("<H", fmt_data[2:4])[0]
                    sample_rate = struct.unpack("<I", fmt_data[4:8])[0]
                    byte_rate = struct.unpack("<I", fmt_data[8:12])[0]
                    bits_per_sample = struct.unpack("<H", fmt_data[14:16])[0] if len(fmt_data) >= 16 else 16
                    if byte_rate > 0:
                        res["duration_seconds"] = round((file_size - 44) / byte_rate, 2)
                        res["bitrate"] = int(byte_rate * 8)
                    break
                pos += 8 + chunk_size

        # ── MP3 ID3v2 Parsing ────────────────────────────────────────────────
        elif ext == ".mp3" and header[:3] == b"ID3":
            major_ver = header[3]
            tag_size = (
                ((header[6] & 0x7F) << 21)
                | ((header[7] & 0x7F) << 14)
                | ((header[8] & 0x7F) << 7)
                | (header[9] & 0x7F)
            )
            # Read full ID3 tag if reasonable size
            with open(file_path, "rb") as f:
                tag_data = f.read(min(tag_size + 10, 128 * 1024))

            pos = 10
            while pos + 10 < len(tag_data):
                frame_id = tag_data[pos:pos + 4].decode("ascii", errors="ignore")
                if not frame_id or not frame_id.isalnum():
                    break
                frame_size = struct.unpack(">I", tag_data[pos + 4:pos + 8])[0]
                # Syncsafe in ID3v2.4
                if major_ver == 4:
                    frame_size = (
                        ((frame_size >> 24) & 0x7F) << 21
                        | ((frame_size >> 16) & 0x7F) << 14
                        | ((frame_size >> 8) & 0x7F) << 7
                        | (frame_size & 0x7F)
                    )
                if frame_size <= 0 or pos + 10 + frame_size > len(tag_data):
                    break
                frame_body = tag_data[pos + 10:pos + 10 + frame_size]
                pos += 10 + frame_size

                # Extract text
                try:
                    encoding = frame_body[0] if len(frame_body) > 0 else 0
                    raw_str = frame_body[1:]
                    if encoding == 1:
                        txt = raw_str.decode("utf-16", errors="ignore").rstrip("\x00").strip()
                    else:
                        txt = raw_str.decode("latin-1", errors="ignore").rstrip("\x00").strip()

                    if frame_id == "TIT2":
                        res["audio_title"] = txt
                    elif frame_id == "TPE1":
                        res["audio_artist"] = txt
                    elif frame_id == "TALB":
                        res["audio_album"] = txt
                except Exception:
                    pass

            # Estimate MP3 duration using standard 128kbps fallback if audio frame sync missing
            res["bitrate"] = 128000
            res["duration_seconds"] = round((file_size * 8) / 128000, 2)

        # ── FLAC Parsing ─────────────────────────────────────────────────────
        elif ext == ".flac" and header[:4] == b"fLaC":
            # STREAMINFO block follows header (starts at byte 4)
            if len(header) >= 42:
                stream_info = header[4:42]
                sr_bytes = stream_info[14:17]
                sample_rate = (sr_bytes[0] << 12) | (sr_bytes[1] << 4) | (sr_bytes[2] >> 4)
                total_samples = struct.unpack(">Q", b"\x00\x00\x00" + stream_info[17:22])[0] & 0x0000000FFFFFFFFF
                if sample_rate > 0:
                    res["duration_seconds"] = round(total_samples / sample_rate, 2)

    except Exception as e:
        res["status"] = "corrupt"
        res["error"] = str(e)

    return res


def parse_archive_metadata(file_path: str, ext: str) -> Dict[str, Any]:
    """Inspect ZIP and TAR archives in read-only mode without unpacking files."""
    import zipfile
    import tarfile

    res = {
        "archive_entries": None,
        "status": "ok",
        "error": None,
    }

    try:
        if ext == ".zip":
            if not zipfile.is_zipfile(file_path):
                res["status"] = "corrupt"
                res["error"] = "Invalid ZIP archive structure"
                return res

            with zipfile.ZipFile(file_path, "r") as z:
                entries = z.infolist()
                res["archive_entries"] = len(entries)
                if any(entry.flag_bits & 0x1 for entry in entries):
                    res["status"] = "encrypted"
                    res["error"] = "Password-protected archive"

        elif ext in (".tar", ".gz", ".tgz"):
            with tarfile.open(file_path, "r:*") as t:
                res["archive_entries"] = len(t.getmembers())

    except Exception as e:
        res["status"] = "corrupt"
        res["error"] = str(e)

    return res


def parse_text_metadata(file_path: str) -> Dict[str, Any]:
    """Read plaintext, markdown, and code files to extract line counts, word counts, and search previews."""
    res = {
        "word_count": None,
        "page_count": None,
        "text_preview": None,
        "status": "ok",
        "error": None,
    }

    try:
        file_size = os.path.getsize(file_path)
        read_bytes = min(file_size, 32 * 1024)  # 32KB sample
        with open(file_path, "rb") as f:
            raw = f.read(read_bytes)

        # Decode with UTF-8 first, fallback to Latin-1
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1", errors="ignore")

        lines = text.splitlines()
        words = text.split()
        res["page_count"] = max(1, len(lines) // 40)
        res["word_count"] = len(words)
        res["text_preview"] = text[:3000].strip() or None

    except Exception as e:
        res["status"] = "corrupt"
        res["error"] = str(e)

    return res


# ─── Hashing & Perceptual Fingerprints ────────────────────────────────────────

def compute_hashes(file_path: str) -> Dict[str, Any]:
    """Calculate SHA-256, MD5, and perceptual difference hash (dHash)."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    stat_before = os.stat(file_path)
    sha256 = hashlib.sha256()
    md5 = hashlib.md5()
    file_size = stat_before.st_size

    # 64 KB chunked buffer streaming
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
            md5.update(chunk)

    stat_after = os.stat(file_path)
    if stat_before.st_size != stat_after.st_size or stat_before.st_mtime_ns != stat_after.st_mtime_ns:
        raise IOError(f"File modified during hashing: {file_path}")

    result = {
        "sha256": sha256.hexdigest(),
        "md5": md5.hexdigest(),
        "size_bytes": file_size,
        "phash": None,
    }

    # Perceptual hash for images
    try:
        if HAS_CV2:
            img = cv2.imread(file_path, cv2.IMREAD_GRAYSCALE)
            if img is not None and img.size > 0:
                # 9x8 resizing for 8x8 difference hash
                resized = cv2.resize(img, (9, 8), interpolation=cv2.INTER_AREA)
                diff = resized[:, :-1] > resized[:, 1:]
                decimal_val = 0
                flat = diff.flatten()
                for idx, val in enumerate(flat):
                    if val:
                        decimal_val |= 1 << idx
                result["phash"] = f"{decimal_val:016x}"
        elif HAS_PIL:
            with Image.open(file_path) as img:
                img_gray = img.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
                pixels = list(img_gray.getdata())
                diff = []
                for row in range(8):
                    for col in range(8):
                        diff.append(pixels[row * 9 + col] > pixels[row * 9 + col + 1])
                decimal_val = 0
                for idx, val in enumerate(diff):
                    if val:
                        decimal_val |= 1 << idx
                result["phash"] = f"{decimal_val:016x}"
    except Exception:
        pass

    return result


# ─── Comprehensive Metadata Intelligence Engine ──────────────────────────────

def extract_metadata(file_path: str) -> Dict[str, Any]:
    """Modular extraction pipeline supporting images, videos, documents, audio, and archives."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    stat = os.stat(file_path)
    ext = os.path.splitext(file_path)[1].lower()

    # Determine format category
    category = "other"
    if ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif", ".heic", ".heif", ".raw", ".cr2", ".nef", ".arw", ".dng"):
        category = "image"
    elif ext in (".mp4", ".mov", ".avi", ".mkv", ".wmv", ".webm", ".m4v", ".flv", ".3gp"):
        category = "video"
    elif ext in (".pdf", ".docx", ".pptx", ".xlsx", ".doc", ".ppt", ".xls", ".odt", ".ods"):
        category = "document"
    elif ext in (".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".wma", ".opus"):
        category = "audio"
    elif ext in (".zip", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bz2"):
        category = "archive"
    elif ext in (".txt", ".md", ".markdown", ".csv", ".json", ".xml", ".html", ".css", ".js", ".ts", ".py", ".sql", ".log", ".yaml", ".yml", ".ini", ".env"):
        category = "text"

    metadata: Dict[str, Any] = {
        "size_bytes": stat.st_size,
        "modified_at": stat.st_mtime,
        "created_at": stat.st_ctime,
        "format_category": category,
        "status": "unsupported" if category == "other" else "ok",
        "error": None,
        "extractor_version": "nexora-meta-2.0",
        "width": None,
        "height": None,
        "duration_seconds": None,
        "capture_time": None,
        "has_gps": False,
        "latitude": None,
        "longitude": None,
        "altitude": None,
        "camera_make": None,
        "camera_model": None,
        "lens_model": None,
        "iso": None,
        "focal_length": None,
        "aperture": None,
        "exposure_time": None,
        "orientation": None,
        "codec": None,
        "frame_rate": None,
        "bitrate": None,
        "page_count": None,
        "word_count": None,
        "doc_title": None,
        "doc_author": None,
        "doc_subject": None,
        "text_preview": None,
        "audio_artist": None,
        "audio_album": None,
        "audio_title": None,
        "archive_entries": None,
        "color_profile": None,
    }

    # 1. Images
    if category == "image":
        exif = parse_jpeg_exif(file_path)
        for k in ("capture_time", "camera_make", "camera_model", "lens_model", "orientation",
                  "iso", "focal_length", "aperture", "exposure_time", "has_gps", "latitude", "longitude", "altitude", "color_profile"):
            if exif.get(k) is not None:
                metadata[k] = exif[k]

        if HAS_CV2:
            try:
                img = cv2.imread(file_path)
                if img is not None:
                    metadata["height"], metadata["width"] = img.shape[:2]
            except Exception:
                pass
        elif HAS_PIL:
            try:
                with Image.open(file_path) as img:
                    metadata["width"], metadata["height"] = img.size
            except Exception:
                pass

    # 2. Videos
    elif category == "video":
        if HAS_CV2:
            try:
                cap = cv2.VideoCapture(file_path)
                if cap.isOpened():
                    metadata["width"] = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                    metadata["height"] = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
                    metadata["frame_rate"] = round(float(fps), 2)
                    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                    if fps > 0 and frame_count > 0:
                        metadata["duration_seconds"] = round(frame_count / fps, 2)

                    # Extract FourCC codec
                    fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
                    if fourcc:
                        codec_str = "".join([chr((fourcc >> 8 * i) & 0xFF) for i in range(4)]).strip()
                        if codec_str:
                            metadata["codec"] = codec_str
                    cap.release()
            except Exception:
                pass

    # 3. Documents
    elif category == "document":
        if ext == ".pdf":
            pdf_data = parse_pdf_metadata(file_path)
            for k, v in pdf_data.items():
                if v is not None and k in metadata:
                    metadata[k] = v
        elif ext in (".docx", ".pptx", ".xlsx"):
            office_data = parse_office_metadata(file_path, ext)
            for k, v in office_data.items():
                if v is not None and k in metadata:
                    metadata[k] = v

    # 4. Audio
    elif category == "audio":
        audio_data = parse_audio_metadata(file_path, ext)
        for k, v in audio_data.items():
            if v is not None and k in metadata:
                metadata[k] = v

    # 5. Archives
    elif category == "archive":
        archive_data = parse_archive_metadata(file_path, ext)
        for k, v in archive_data.items():
            if v is not None and k in metadata:
                metadata[k] = v

    # 6. Plain Text & Code
    elif category == "text":
        txt_data = parse_text_metadata(file_path)
        for k, v in txt_data.items():
            if v is not None and k in metadata:
                metadata[k] = v

    return metadata


# ─── Thumbnail Generation ────────────────────────────────────────────────────

def generate_thumbnail(file_path: str, output_path: str, max_size: int = 256) -> Dict[str, Any]:
    """Generate high-quality downscaled thumbnail for grid display."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    try:
        if HAS_CV2:
            img = cv2.imread(file_path)
            if img is None:
                # Could be a video file, try reading first frame
                cap = cv2.VideoCapture(file_path)
                if cap.isOpened():
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        img = frame
                    cap.release()

            if img is not None:
                h, w = img.shape[:2]
                scale = min(max_size / max(w, 1), max_size / max(h, 1))
                new_w, new_h = max(int(w * scale), 1), max(int(h * scale), 1)
                thumb = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
                cv2.imwrite(output_path, thumb, [cv2.IMWRITE_JPEG_QUALITY, 85])
                return {"success": True, "thumbnail_path": output_path}

        elif HAS_PIL:
            with Image.open(file_path) as img:
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.save(output_path, "JPEG", quality=85)
            return {"success": True, "thumbnail_path": output_path}

        return {"success": False, "error": "No image processor available"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─── Offline AI Model Registry & Cryptographic Integrity ─────────────────────

_MANIFEST: Optional[Dict[str, Any]] = None
_VERIFIED_MODELS: Dict[str, bool] = {}

_FACE_DETECTOR = None
_FACE_RECOGNIZER = None
_IMAGE_CLASSIFIER = None
_IMAGENET_LABELS: Optional[List[str]] = None
_TEXT_DETECTOR = None
_TEXT_RECOGNIZER = None


def get_models_dir() -> str:
    """Resolve models directory across dev and packaged electron environments."""
    if os.environ.get("NEXORA_MODELS_DIR") and os.path.isdir(os.environ["NEXORA_MODELS_DIR"]):
        return os.path.abspath(os.environ["NEXORA_MODELS_DIR"])

    if os.environ.get("RESOURCES_PATH"):
        res_models = os.path.join(os.environ["RESOURCES_PATH"], "models")
        if os.path.isdir(res_models):
            return os.path.abspath(res_models)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(script_dir, "..", "..", "models"),
        os.path.join(script_dir, "..", "models"),
        os.path.join(os.getcwd(), "models"),
        os.path.join(os.path.dirname(sys.executable), "resources", "models"),
    ]
    for c in candidates:
        if os.path.isdir(c):
            return os.path.abspath(c)
    return os.path.abspath(candidates[0])


def get_manifest() -> Dict[str, Any]:
    """Load authoritative offline models manifest."""
    global _MANIFEST
    if _MANIFEST is not None:
        return _MANIFEST
    models_dir = get_models_dir()
    manifest_path = os.path.join(models_dir, "manifest.json")
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                _MANIFEST = json.load(f)
                return _MANIFEST
        except Exception as e:
            sys.stderr.write(f"[AI-Worker] Failed to read manifest: {e}\n")
    _MANIFEST = {"models": [], "offline_ready": False}
    return _MANIFEST


def verify_model(filename: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Verify SHA-256 integrity of model file against manifest before loading."""
    models_dir = get_models_dir()
    full_path = os.path.join(models_dir, filename)

    if filename in _VERIFIED_MODELS:
        return _VERIFIED_MODELS[filename], full_path if _VERIFIED_MODELS[filename] else None, None

    if not os.path.exists(full_path):
        _VERIFIED_MODELS[filename] = False
        return False, None, f"Model file not found: {filename}"

    manifest = get_manifest()
    spec = next((m for m in manifest.get("models", []) if m.get("filename") == filename), None)
    expected_hash = spec.get("sha256") if spec else None

    try:
        hasher = hashlib.sha256()
        with open(full_path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        calc_hash = hasher.hexdigest().lower()

        if expected_hash and calc_hash != expected_hash.lower():
            sys.stderr.write(f"[AI-Worker] Model integrity error for {filename}: expected {expected_hash}, got {calc_hash}\n")
            _VERIFIED_MODELS[filename] = False
            return False, full_path, f"Checksum verification failed for {filename}"

        _VERIFIED_MODELS[filename] = True
        return True, full_path, None
    except Exception as e:
        _VERIFIED_MODELS[filename] = False
        return False, full_path, str(e)


def get_face_detector():
    """Lazy-load and initialize verified YuNet face detector."""
    global _FACE_DETECTOR
    if _FACE_DETECTOR is not None:
        return _FACE_DETECTOR
    if not HAS_CV2:
        return None
    valid, path, _ = verify_model("face_detection_yunet_2023mar.onnx")
    if not valid or not path:
        return None
    try:
        _FACE_DETECTOR = cv2.FaceDetectorYN.create(path, "", (320, 320), 0.6, 0.3)
    except Exception as e:
        sys.stderr.write(f"[AI-Worker] Failed to create YuNet detector: {e}\n")
    return _FACE_DETECTOR


def get_face_recognizer():
    """Lazy-load and initialize verified SFace biometric recognizer."""
    global _FACE_RECOGNIZER
    if _FACE_RECOGNIZER is not None:
        return _FACE_RECOGNIZER
    if not HAS_CV2:
        return None
    valid, path, _ = verify_model("face_recognition_sface_2021dec_int8.onnx")
    if not valid or not path:
        return None
    try:
        _FACE_RECOGNIZER = cv2.FaceRecognizerSF.create(path, "")
    except Exception as e:
        sys.stderr.write(f"[AI-Worker] Failed to create SFace recognizer: {e}\n")
    return _FACE_RECOGNIZER


def get_image_classifier():
    """Lazy-load MobileNetV2 classifier and ImageNet labels."""
    global _IMAGE_CLASSIFIER, _IMAGENET_LABELS
    if _IMAGE_CLASSIFIER is not None:
        return _IMAGE_CLASSIFIER, _IMAGENET_LABELS
    if not HAS_CV2:
        return None, None
    valid, path, _ = verify_model("image_classification_mobilenetv2_2022apr_int8.onnx")
    if not valid or not path:
        return None, None
    try:
        _IMAGE_CLASSIFIER = cv2.dnn.readNetFromONNX(path)
        labels_path = os.path.join(get_models_dir(), "labels", "imagenet_classes.txt")
        if os.path.exists(labels_path):
            with open(labels_path, "r", encoding="utf-8") as f:
                _IMAGENET_LABELS = [l.strip() for l in f if l.strip()]
        else:
            _IMAGENET_LABELS = []
    except Exception as e:
        sys.stderr.write(f"[AI-Worker] Failed to load MobileNet: {e}\n")
    return _IMAGE_CLASSIFIER, _IMAGENET_LABELS


def get_ocr_engine():
    """Lazy-load PP-OCR detection and CRNN recognition models."""
    global _TEXT_DETECTOR, _TEXT_RECOGNIZER
    if _TEXT_DETECTOR is not None and _TEXT_RECOGNIZER is not None:
        return _TEXT_DETECTOR, _TEXT_RECOGNIZER
    if not HAS_CV2:
        return None, None

    valid_det, det_path, _ = verify_model("text_detection_en_ppocrv3_2023may_int8.onnx")
    valid_rec, rec_path, _ = verify_model("text_recognition_CRNN_EN_2022oct_int8.onnx")
    if not valid_det or not valid_rec or not det_path or not rec_path:
        return None, None

    try:
        if hasattr(cv2.dnn, "TextDetectionModel_DB") and hasattr(cv2.dnn, "TextRecognitionModel"):
            det = cv2.dnn.TextDetectionModel_DB(det_path)
            det.setBinaryThreshold(0.3)
            det.setPolygonThreshold(0.5)
            det.setInputParams(1.0 / 255.0, (736, 736), (123.68, 116.78, 103.94), True)

            rec = cv2.dnn.TextRecognitionModel(rec_path)
            alpha_path = os.path.join(get_models_dir(), "labels", "crnn_alphabet.txt")
            if os.path.exists(alpha_path):
                with open(alpha_path, "r", encoding="utf-8") as f:
                    alphabet = [l.strip() for l in f if l.strip()]
            else:
                alphabet = list("0123456789abcdefghijklmnopqrstuvwxyz")
            rec.setVocabulary(alphabet)
            rec.setDecodeType("CTC-greedy")
            rec.setInputParams(1.0 / 127.5, (100, 32), (127.5, 127.5, 127.5), True)

            _TEXT_DETECTOR = det
            _TEXT_RECOGNIZER = rec
            return _TEXT_DETECTOR, _TEXT_RECOGNIZER
    except Exception as e:
        sys.stderr.write(f"[AI-Worker] Failed to load OCR models: {e}\n")
    return None, None


# ─── Face Detection & Feature Extraction ─────────────────────────────────────

def detect_faces(file_path: str) -> List[Dict[str, Any]]:
    """Detect faces and return normalized bounding boxes with deterministic embeddings."""
    if not os.path.exists(file_path):
        return []

    faces: List[Dict[str, Any]] = []

    if HAS_CV2 and HAS_NUMPY:
        try:
            img = cv2.imread(file_path)
            if img is None:
                return []

            h, w = img.shape[:2]
            max_dim = max(h, w)
            if max_dim > 1600:
                scale = 1600.0 / max_dim
                new_w = max(int(w * scale), 1)
                new_h = max(int(h * scale), 1)
                img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
                h, w = img.shape[:2]

            detector = get_face_detector()
            recognizer = get_face_recognizer()

            if detector is not None:
                detector.setInputSize((w, h))
                _, raw_detections = detector.detect(img)
                if raw_detections is not None:
                    for det in raw_detections:
                        fx = float(det[0])
                        fy = float(det[1])
                        fw = float(det[2])
                        fh = float(det[3])
                        conf = float(det[14])

                        if fw <= 0 or fh <= 0 or conf < 0.60:
                            continue

                        embedding = None
                        if recognizer is not None:
                            try:
                                aligned = recognizer.alignCrop(img, det)
                                feature = recognizer.feature(aligned)
                                feat_vec = feature.flatten().astype(np.float32)
                                norm = np.linalg.norm(feat_vec)
                                if norm > 0:
                                    feat_vec /= norm
                                embedding = [round(float(v), 5) for v in feat_vec]
                            except Exception:
                                pass

                        if embedding is None:
                            ix, iy = max(int(fx), 0), max(int(fy), 0)
                            iw, ih = min(int(fw), w - ix), min(int(fh), h - iy)
                            if iw > 0 and ih > 0:
                                face_crop = img[iy:iy+ih, ix:ix+iw]
                                gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
                                resized = cv2.resize(gray, (8, 8), interpolation=cv2.INTER_AREA)
                                norm_face = resized.astype(np.float32).flatten()
                                norm = np.linalg.norm(norm_face)
                                if norm > 0:
                                    norm_face /= norm
                                embedding = [round(float(v), 5) for v in norm_face]
                            else:
                                embedding = [0.0] * 64

                        faces.append({
                            "x": round(fx / w, 4),
                            "y": round(fy / h, 4),
                            "width": round(fw / w, 4),
                            "height": round(fh / h, 4),
                            "confidence": round(conf, 2),
                            "quality_score": round(min(conf * 1.05, 1.0), 2),
                            "embedding": embedding,
                        })

            if faces:
                faces.sort(key=lambda f: f["width"] * f["height"], reverse=True)
                return faces[:10]

            # ── Fallback: Skin tone segmentation & Laplacian filter if no YuNet or edge case ──
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
            skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            skin_mask = cv2.erode(skin_mask, kernel, iterations=1)
            skin_mask = cv2.dilate(skin_mask, kernel, iterations=2)

            contours, _ = cv2.findContours(skin_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            min_face_area = (w * h) * 0.005
            max_face_area = (w * h) * 0.70

            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area < min_face_area or area > max_face_area:
                    continue

                x, y, fw, fh = cv2.boundingRect(cnt)
                aspect_ratio = fw / float(fh)
                if 0.55 <= aspect_ratio <= 1.35:
                    face_roi = gray[y:y + fh, x:x + fw]
                    if face_roi.size == 0:
                        continue

                    laplacian_var = cv2.Laplacian(face_roi, cv2.CV_64F).var()
                    quality_score = min(max(float(laplacian_var) / 500.0, 0.1), 1.0)

                    resized_face = cv2.resize(face_roi, (8, 8), interpolation=cv2.INTER_AREA)
                    norm_face = resized_face.astype(np.float32).flatten()
                    norm = np.linalg.norm(norm_face)
                    if norm > 0:
                        norm_face /= norm

                    faces.append({
                        "x": round(x / w, 4),
                        "y": round(y / h, 4),
                        "width": round(fw / w, 4),
                        "height": round(fh / h, 4),
                        "confidence": round(0.75 + min(quality_score * 0.2, 0.23), 2),
                        "quality_score": round(quality_score, 2),
                        "embedding": [round(float(v), 5) for v in norm_face],
                    })

            faces.sort(key=lambda f: f["width"] * f["height"], reverse=True)
            faces = faces[:10]

        except Exception:
            pass

    return faces


# ─── Image Classification & Scene Tagging ────────────────────────────────────

def classify_image(file_path: str) -> Dict[str, Any]:
    """Classify image content using bundled MobileNetV2 and generate semantic tags."""
    if not os.path.exists(file_path) or not HAS_CV2 or not HAS_NUMPY:
        return {"top_classes": [], "tags": []}

    net, labels = get_image_classifier()
    if net is None:
        return {"top_classes": [], "tags": []}

    try:
        img = cv2.imread(file_path)
        if img is None:
            return {"top_classes": [], "tags": []}

        blob = cv2.dnn.blobFromImage(
            img, 1.0 / 255.0, (224, 224),
            (0.485, 0.456, 0.406), swapRB=True, crop=False
        )
        net.setInput(blob)
        preds = net.forward()
        probs = preds[0]

        top_indices = np.argsort(probs)[-3:][::-1]
        top_classes = []
        tags = []

        for idx in top_indices:
            score = float(probs[idx])
            if score > 0.10:
                label = labels[idx] if labels and idx < len(labels) else f"class_{idx}"
                top_classes.append({"label": label, "confidence": round(score, 3)})
                clean_tag = label.split(",")[0].strip().lower()
                if clean_tag and clean_tag not in tags:
                    tags.append(clean_tag)

        return {"top_classes": top_classes, "tags": tags}
    except Exception as e:
        sys.stderr.write(f"[AI-Worker] Classification error: {e}\n")
        return {"top_classes": [], "tags": []}


# ─── Optical Character Recognition (OCR) ────────────────────────────────────

def extract_ocr(file_path: str) -> Dict[str, Any]:
    """Extract visible text using bundled PP-OCRv3 detection and CRNN recognition."""
    if not os.path.exists(file_path):
        return {"text": "", "confidence": 0.0, "status": "missing_file"}

    ext = os.path.splitext(file_path)[1].lower()
    if ext in ('.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.json', '.csv'):
        meta = extract_metadata(file_path)
        if meta.get("text_preview"):
            return {
                "text": meta["text_preview"],
                "confidence": 0.99,
                "model_version": "native-doc-parser",
                "status": "ok"
            }

    if not HAS_CV2 or not HAS_NUMPY:
        return {"text": "", "confidence": 0.0, "status": "cv2_unavailable"}

    det, rec = get_ocr_engine()
    if det is None or rec is None:
        return {"text": "", "confidence": 0.0, "status": "models_unavailable"}

    try:
        img = cv2.imread(file_path)
        if img is None:
            return {"text": "", "confidence": 0.0, "status": "cannot_read_image"}

        boxes, _ = det.detect(img)
        if not boxes or len(boxes) == 0:
            return {"text": "", "confidence": 0.0, "status": "no_text_detected"}

        recognized_texts = []
        for box in boxes[:50]:
            x, y, w, h = cv2.boundingRect(box)
            if w < 8 or h < 8:
                continue
            crop = img[max(y, 0):min(y + h, img.shape[0]), max(x, 0):min(x + w, img.shape[1])]
            if crop.size == 0:
                continue
            try:
                line_text = rec.recognize(crop)
                if line_text and len(line_text.strip()) > 1:
                    recognized_texts.append(line_text.strip())
            except Exception:
                pass

        full_text = " ".join(recognized_texts)
        return {
            "text": full_text,
            "confidence": 0.85 if full_text else 0.0,
            "model_version": "ppocr-crnn-v3",
            "status": "ok" if full_text else "empty"
        }
    except Exception as e:
        sys.stderr.write(f"[AI-Worker] OCR error: {e}\n")
        return {"text": "", "confidence": 0.0, "status": "error", "error": str(e)}


# ─── Cosine Distance Clustering ──────────────────────────────────────────────

def cluster_faces(embeddings: List[List[float]], threshold: float = 0.6) -> List[int]:
    """Cluster face embedding vectors using pairwise cosine distance threshold."""
    if not embeddings:
        return []

    n = len(embeddings)
    cluster_ids = [-1] * n
    current_cluster = 0

    if HAS_NUMPY:
        cluster_ids_np = np.full(n, -1, dtype=int)
        arr = np.array(embeddings, dtype=np.float32)
        # Compute norms
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        normalized = arr / norms
        # Pairwise cosine similarity matrix
        sim_matrix = np.dot(normalized, normalized.T)
        dist_matrix = 1.0 - sim_matrix

        for i in range(n):
            if cluster_ids_np[i] != -1:
                continue
            cluster_ids_np[i] = current_cluster
            # Find all unassigned vectors within threshold
            matches = np.where((cluster_ids_np == -1) & (dist_matrix[i] < threshold))[0]
            for m in matches:
                cluster_ids_np[m] = current_cluster
            current_cluster += 1
        return cluster_ids_np.tolist()
    else:
        # Pure Python fallback
        def cosine_dist(v1, v2):
            dot = sum(a * b for a, b in zip(v1, v2))
            norm1 = sum(a * a for a in v1) ** 0.5
            norm2 = sum(b * b for b in v2) ** 0.5
            if norm1 == 0 or norm2 == 0:
                return 1.0
            return 1.0 - (dot / (norm1 * norm2))

        for i in range(n):
            if cluster_ids[i] != -1:
                continue
            cluster_ids[i] = current_cluster
            for j in range(i + 1, n):
                if cluster_ids[j] == -1 and cosine_dist(embeddings[i], embeddings[j]) < threshold:
                    cluster_ids[j] = current_cluster
            current_cluster += 1

    return cluster_ids


# ─── Video Analysis & Timestamp Sampling ─────────────────────────────────────

def analyze_video(file_path: str, interval_seconds: int = 5) -> List[Dict[str, Any]]:
    """Sample video frames at regular intervals with direct seeking and duplicate suppression."""
    observations: List[Dict[str, Any]] = []

    if not HAS_CV2 or not HAS_NUMPY or not os.path.exists(file_path):
        return observations

    try:
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            return observations

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        frame_interval = max(int(fps * max(interval_seconds, 1)), 1)
        current_frame = 0
        last_sampled_thumb = None

        while current_frame < total_frames if total_frames > 0 else True:
            # Fast direct seek instead of sequential full decoding
            cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame)
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            timestamp = round(current_frame / fps, 2)
            h, w = frame.shape[:2]

            # Fast duplicate / static frame suppression: compare with last sampled thumbnail
            try:
                small = cv2.resize(frame, (64, 64), interpolation=cv2.INTER_AREA)
                small_gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                if last_sampled_thumb is not None:
                    diff = float(np.mean(np.abs(small_gray.astype(np.float32) - last_sampled_thumb.astype(np.float32))))
                    if diff < 2.5:  # Static shot; skip redundant face extraction
                        current_frame += frame_interval
                        continue
                last_sampled_thumb = small_gray
            except Exception:
                pass

            # Scale down large 4K / 1080p frames to 960px max dimension for fast processing
            max_dim = max(h, w)
            if max_dim > 960:
                scale = 960.0 / max_dim
                proc_w = max(int(w * scale), 1)
                proc_h = max(int(h * scale), 1)
                proc_frame = cv2.resize(frame, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
            else:
                proc_frame = frame
                proc_w, proc_h = w, h

            gray = cv2.cvtColor(proc_frame, cv2.COLOR_BGR2GRAY)
            ycrcb = cv2.cvtColor(proc_frame, cv2.COLOR_BGR2YCrCb)
            skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
            contours, _ = cv2.findContours(skin_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            detected_faces = []
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area < (proc_w * proc_h) * 0.01:
                    continue
                x, y, fw, fh = cv2.boundingRect(cnt)
                aspect = fw / float(fh)
                if 0.6 <= aspect <= 1.3:
                    face_roi = gray[y:y + fh, x:x + fw]
                    if face_roi.size == 0:
                        continue
                    resized = cv2.resize(face_roi, (8, 8))
                    norm_face = resized.astype(np.float32).flatten()
                    norm = np.linalg.norm(norm_face)
                    if norm > 0:
                        norm_face /= norm

                    detected_faces.append({
                        "x": round(x / proc_w, 4),
                        "y": round(y / proc_h, 4),
                        "width": round(fw / proc_w, 4),
                        "height": round(fh / proc_h, 4),
                        "confidence": 0.80,
                        "quality_score": 0.75,
                        "embedding": [round(float(v), 5) for v in norm_face],
                    })

            if detected_faces:
                observations.append({
                    "timestamp_seconds": timestamp,
                    "frame_number": current_frame,
                    "faces": detected_faces,
                })

            current_frame += frame_interval
            # Cap at maximum 100 observations per video to avoid runaway processing
            if len(observations) >= 100:
                break

        cap.release()
    except Exception:
        pass

    return observations


# ─── RPC Dispatcher & Main Event Loop ────────────────────────────────────────

def handle_request(req: Dict[str, Any]) -> Dict[str, Any]:
    """Dispatch incoming JSON-RPC command."""
    req_id = req.get("id")
    action = req.get("action")
    params = req.get("params", {})

    try:
        if action == "ping":
            gpu_accel = "CPU"
            try:
                if HAS_CV2 and hasattr(cv2, "cuda") and cv2.cuda.getCudaEnabledDeviceCount() > 0:
                    gpu_accel = "CUDA"
            except Exception:
                pass

            manifest = get_manifest()
            model_checks = {}
            for m in manifest.get("models", []):
                fn = m.get("filename", "")
                task = m.get("task", fn)
                valid, _, _ = verify_model(fn)
                model_checks[task] = valid

            return {
                "id": req_id,
                "status": "ok",
                "result": {
                    "pong": True,
                    "cv2": HAS_CV2,
                    "numpy": HAS_NUMPY,
                    "pil": HAS_PIL,
                    "acceleration": gpu_accel,
                    "models": model_checks,
                    "offline_ready": True,
                },
            }

        elif action == "get_model_manifest":
            manifest = get_manifest()
            models_status = []
            for m in manifest.get("models", []):
                filename = m.get("filename", "")
                valid, path, err = verify_model(filename)
                models_status.append({
                    **m,
                    "verified": valid,
                    "resolved_path": path,
                    "error": err
                })
            return {
                "id": req_id,
                "status": "ok",
                "result": {
                    "version": manifest.get("version", "1.0.0"),
                    "models_dir": get_models_dir(),
                    "offline_ready": True,
                    "models": models_status
                }
            }

        elif action == "classify_image":
            res = classify_image(params["file_path"])
            return {"id": req_id, "status": "ok", "result": res}

        elif action == "extract_ocr":
            res = extract_ocr(params["file_path"])
            return {"id": req_id, "status": "ok", "result": res}

        elif action == "compute_hashes":
            res = compute_hashes(params["file_path"])
            return {"id": req_id, "status": "ok", "result": res}

        elif action == "extract_metadata":
            res = extract_metadata(params["file_path"])
            return {"id": req_id, "status": "ok", "result": res}

        elif action == "generate_thumbnail":
            res = generate_thumbnail(
                params["file_path"],
                params["output_path"],
                params.get("max_size", 256),
            )
            return {"id": req_id, "status": "ok", "result": res}

        elif action == "detect_faces":
            res = detect_faces(params["file_path"])
            return {"id": req_id, "status": "ok", "result": res}

        elif action == "cluster_faces":
            res = cluster_faces(params["embeddings"], params.get("threshold", 0.6))
            return {"id": req_id, "status": "ok", "result": res}

        elif action == "analyze_video":
            res = analyze_video(params["file_path"], params.get("interval_seconds", 5))
            return {"id": req_id, "status": "ok", "result": res}

        else:
            return {"id": req_id, "status": "error", "message": f"Unknown action: {action}"}

    except Exception as e:
        return {
            "id": req_id,
            "status": "error",
            "message": str(e),
            "traceback": traceback.format_exc(),
        }


def main():
    """Main JSON-RPC server loop over unbuffered stdin/stdout."""
    sys.stdout.reconfigure(line_buffering=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            resp = handle_request(req)
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        except json.JSONDecodeError as e:
            err_resp = {"status": "error", "message": f"Malformed JSON: {str(e)}"}
            sys.stdout.write(json.dumps(err_resp) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
