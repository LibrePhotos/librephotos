import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from api.mime import VIDEO_EXTENSIONS
from api.runtime import binaries
from api.video import color, ffmpeg_budget, frames
from api.video.no_metadata import NO_METADATA

TIMEOUT = 300
PREVIEW_SECONDS = 5
PREVIEW_CRF = 20
SQUARE_HEIGHT = 500
LIVE_THREADS = "2"
LIVE_READRATE = "2.0"
LIVE_BURST_SECONDS = "30.0"
CACHED_THREADS = "2"
CACHED_PRESET = "veryfast"
VIDEO_NO_METADATA = (*NO_METADATA, "-map_metadata:s:v", "-1", "-map_metadata:s:a", "-1")
NO_FRAME = "Output file is empty, nothing was encoded"
PIPELINES = ("probe", "thumbnail", "preview", "live", "cached", "frame", "remux")
REQUIRED = {
    "encoders": {"libx264", "aac", "mjpeg", "libwebp", "libwebp_anim"},
    "decoders": {"libdav1d", "h264", "hevc", "vp9", "prores", "mjpeg", "aac"},
    "filters": {
        "scale",
        "format",
        "zscale",
        "tonemap",
        "transpose",
        "hflip",
        "vflip",
        "aresample",
    },
    "protocols": {"file", "pipe"},
    "options": {
        "readrate",
        "readrate_initial_burst",
        "filter_threads",
        "progress",
        "ignore_editlist",
    },
}

FATE = "https://fate-suite.ffmpeg.org/"
FATE_SAMPLES = {
    "mov/displaymatrix.mov": "02ad3fcdc28a1c8d9d81384829f60c5c28cd23a5a8570cbb56d0f90647ba92b4",
    "h264/crop-to-container-dims-canon.mov": "5b9f021275a8db5e27288559dbc087763d8d6ac52fc1a07336d03e2b3cd81737",
    "mxf/Meridian-Apple_ProResProxy-HDR10.mxf": "1d6d0f23a300439ddce721e288a63ffe2d01a42d627e53a555a7525acf343e89",
    "dv/dvcprohd_720p50.mov": "bee292c9039c65ef8b8ffedf4ae21ad64b300b843e6d27a3400d03d4cba98f1d",
    "mpegts/h264small.ts": "5e999d972e3d53e5780851933dd0a8428697e14a4d6ba83034960b82e39a920c",
    "mpegps/pcm_aud.mpg": "5c4ca95af37caf20af9c857f3ad2b70526a5fc0b07417e6c27687f03db8812bc",
    "asf/bug821-2.asf": "3bf1768d1a2b862cb531e6e9bb38e5bd4ba0f652ceb9319cef6d16d0b5eb91cf",
    "wmv8/wmv8_x8intra.wmv": "0694e4140214044fbae14116038779dbfb5d96bf82594f00ef30b4578f7ea51e",
    "vc1/SA00040.vc1": "898035e63cfe0ddb1cc2c8749d7dafdfcc1b12fe5dac7e5b65941e6c4e41c860",
    "vc1/SMM0005.rcv": "2de6e6efe960bb0d93b0bfc0229e0b3b1fcdca72eb4b3e290de5f24fafa456f9",
    "mjpeg/mjpeg_field_order.avi": "ce3e326dc7ce75311b20d85b27ab333986cd27a7f9686887019f40abf8136aaf",
    "mkv/hdr10tags-both.mkv": "a136317f7151436a4e25b3c4a9f78d0d378adde3283c81232cfdaf657f9b1a9b",
    "mkv/hdr10_plus_vp9_sample.webm": "593fdb481f9862ab1a33293656e11cdf635742024c6fcd1e675ac8900fb9adb5",
    "mkv/prores_zlib.mkv": "c7fd9412fb2e64c21164ebfbeb5a8d3e26a5ec9d87356bc79681998511b62e90",
    "mkv/spherical.mkv": "91d0895da47b0e74ac4956ef038af3036e5e163edca55e3279c4817fe0999b98",
    "flv/multitrack.flv": "2b1ecf3c0a4c3e0c15524dc357779551a26054488eb7437e94426d7ca338e9ac",
    "ogg/bear.ogv": "c6281b645fc9ddcba7ecc8eb16c525758cec498de9645a5e6be44f6a8962ce57",
    "hap/hap1.mov": "f25aa154610f99fefc3358881d07d2e4f9c2f4880518dc32d95c9bc731031adc",
    "apv/profile_422-10.apv": "abdf4b5e2bf10a6ad8435a5df31f96dde19e0c7f771522db484860966cb9cb77",
    "hevc/dv84.mov": "aaa9289a9755eaebd9962204f24a6acf8a19ff104657a3a79b6b1fa672993721",
    "mov/dovi-p81.mp4": "3313278f3dc49b0b3680ec7c3d72622ec0a770faff9721c5842aaf899d5471c5",
    "mpeg4/packed_bframes.avi": "450a89377f024ce11d176d2be0fa3756df005aa45294866b383fee18a17cbf48",
    "canopus/hqx422.avi": "a1c0e0686ec01e82176508e4e18151f31ddee146a10498b209a04ee6dd7a717e",
    "cfhd/cfhd_odd.mov": "36d9a566c405f147f3fd474a59ae0b4e614f495fa5348293843e613bf1caad16",
    "real/rv30.rm": "e448c7720cff6a2eec9c20ce12d577c5d5c2d6748ecd4acc09102e3e08c67106",
    "amrwb/seed-12k65.awb": "c7900726fea05cf439a913d13d1f185885758796b8ed90ab5d629e040d0a5d9d",
    "amrnb/12.2k.amr": "34445340325350fb5f4e15893c7b1e6bfd3a6f87cd5dc8fc95989f2c3e8164fc",
    "h264/SonyXAVC_LongGOP_green_pixelation_early_Frames.MXF": "5a2e2183c487d948f434eaf49f5caac00ecb04e49e2a844e55be22a6f60194ca",
    "mov/amve.mov": "792aa07f8aef50bdfbb48fb490f0f9336ac6deb5f5ec1b37c1e6079cf83b34f9",
    "prores/Sequence_1-Apple_ProRes_422_Proxy.mov": "2a59729b5cf3293dd06328501bb9b05480e942deed3a1aff1ea67683f9d426d4",
    "dnxhd/dnxhd100_cid1260.mov": "e0f38194b223b85264c2bfb95ab72cb839229803bce11a59f37166e63b5c3a9a",
}

SUBTITLES_NOT_DECODED = "a subtitle codec; LibrePhotos never decodes subtitles"
NETWORK = "a network stream; LibrePhotos reads local files only"
EXPECTED_LOST_CODECS = {
    "arib_caption": SUBTITLES_NOT_DECODED,
    "dvb_teletext": SUBTITLES_NOT_DECODED,
    "avs2": "libdavs2 only: a Chinese broadcast codec no camera or phone writes",
    "avs3": "libuavs3d only: a Chinese broadcast codec no camera or phone writes",
    "jpegxl": "libjxl only: a still image format, which pyvips decodes",
    "jpegxl_anim": "libjxl only: a still image format, which pyvips decodes",
    "svg": "librsvg only: a vector image, never a video",
}
EXPECTED_LOST_DEMUXERS = {
    "avisynth": "AviSynth scripts, not video files",
    "dash": NETWORK,
    "dvdvideo": "DVD folder structures through libdvdread; a .vob file uses the MPEG-PS demuxer",
    "imf": "IMF cinema delivery packages (libxml2), not files in a library",
    "libgme": "game console music, not video",
    "libopenmpt": "tracker music modules, not video",
    "rtp": NETWORK,
    "rtsp": NETWORK,
    "sap": NETWORK,
    "sdp": NETWORK,
}
EXPECTED_REGRESSIONS: dict[str, str] = {}


VIDEO = "-f lavfi -i testsrc2=size={size}:rate={rate}:duration={duration}"
AUDIO = "-f lavfi -i sine=frequency=440:sample_rate={audio_rate}:duration={duration}"
DEFAULTS = {"size": "640x360", "rate": "30", "duration": "2", "audio_rate": "48000"}
PQ = "-vf setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc"
HLG = "-vf setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc"
X264 = "-c:v libx264 -preset ultrafast"
X265 = "-c:v libx265 -preset ultrafast -x265-params log-level=error"
SVTAV1 = "-c:v libsvtav1 -preset 12"
VP9 = "-c:v libvpx-vp9 -deadline realtime -cpu-used 8"
AV = f"{VIDEO} {AUDIO}"


@dataclass
class Synthetic:
    name: str
    inputs: str
    args: str
    needs: list[str] = field(default_factory=list)
    settings: dict[str, str] = field(default_factory=dict)

    def input_args(self, corpus: Path) -> list[str]:
        values = {**DEFAULTS, **self.settings}
        parts = shlex.split(self.inputs.format(**values))
        return [str(corpus / p[1:-1]) if p.startswith("[") else p for p in parts]

    def output_args(self) -> list[str]:
        return shlex.split(self.args)


def rotated(name: str, source: str, degrees: str) -> Synthetic:
    return Synthetic(
        name,
        f"-display_rotation {degrees} -i [synthetic/{source}]",
        "-c copy",
        [f"synthetic/{source}"],
    )


SYNTHETIC = [
    Synthetic("h264_aac.mp4", AV, f"{X264} -pix_fmt yuv420p -c:a aac"),
    Synthetic("h264_high10_aac.mov", AV, f"{X264} -pix_fmt yuv420p10le -c:a aac"),
    Synthetic("h264_422_pcm.mov", AV, f"{X264} -pix_fmt yuv422p -c:a pcm_s16le"),
    Synthetic(
        "h264_444_odd.mp4",
        AV,
        f"{X264} -pix_fmt yuv444p -c:a aac",
        settings={"size": "321x241"},
    ),
    rotated("h264_rot90.mp4", "h264_aac.mp4", "90"),
    rotated("h264_rot180.mp4", "h264_aac.mp4", "180"),
    rotated("h264_rot270.mov", "h264_aac.mp4", "270"),
    Synthetic(
        "h264_1080i_ac3.mts",
        AV,
        f"{X264} -flags +ildct+ilme -x264opts tff=1 -pix_fmt yuv420p -c:a ac3 -f mpegts",
        settings={"size": "1920x1080", "rate": "25"},
    ),
    Synthetic(
        "h264_eac3.m2ts",
        AV,
        f"{X264} -pix_fmt yuv420p -c:a eac3 -f mpegts -mpegts_m2ts_mode 1",
    ),
    Synthetic("h264_mp3.mp4", AV, f"{X264} -pix_fmt yuv420p -c:a libmp3lame"),
    Synthetic("h264_eac3.mp4", AV, f"{X264} -pix_fmt yuv420p -c:a eac3"),
    Synthetic("h264_opus.mp4", AV, f"{X264} -pix_fmt yuv420p -c:a libopus"),
    Synthetic("h264_alac.mov", AV, f"{X264} -pix_fmt yuv420p -c:a alac"),
    Synthetic("h264_pcm24.mov", AV, f"{X264} -pix_fmt yuv420p -c:a pcm_s24le"),
    Synthetic("h264_ac3.mkv", AV, f"{X264} -pix_fmt yuv420p -c:a ac3"),
    Synthetic("h264_flac.mkv", AV, f"{X264} -pix_fmt yuv420p -c:a flac"),
    Synthetic(
        "h264_aac_srt.mkv",
        f"{AV} -i [subtitles.srt]",
        f"{X264} -pix_fmt yuv420p -c:a aac -c:s srt -map 0:v -map 1:a -map 2:s",
        ["subtitles.srt"],
    ),
    Synthetic("h264_aac.flv", AV, f"{X264} -pix_fmt yuv420p -c:a aac"),
    Synthetic(
        "h264_aac.3g2",
        AV,
        f"{X264} -pix_fmt yuv420p -c:a aac -ac 1",
        settings={"size": "352x288", "audio_rate": "16000"},
    ),
    Synthetic("hevc_aac.mp4", AV, f"{X265} -tag:v hvc1 -pix_fmt yuv420p -c:a aac"),
    Synthetic("hevc_main10.mkv", AV, f"{X265} -pix_fmt yuv420p10le -c:a aac"),
    Synthetic(
        "hevc_hdr10_aac.mov",
        AV,
        f"{X265} -tag:v hvc1 -pix_fmt yuv420p10le {PQ} -c:a aac",
        settings={"size": "1280x720"},
    ),
    rotated("hevc_hdr10_rot90.mov", "hevc_hdr10_aac.mov", "90"),
    Synthetic(
        "hevc_hdr10_4k.mov",
        AV,
        f"{X265} -tag:v hvc1 -pix_fmt yuv420p10le {PQ} -c:a aac",
        settings={"size": "3840x2160", "duration": "1"},
    ),
    Synthetic(
        "hevc_hlg_aac.mp4",
        AV,
        f"{X265} -tag:v hvc1 -pix_fmt yuv420p10le {HLG} -c:a aac",
        settings={"size": "1280x720"},
    ),
    Synthetic("av1_opus.mkv", AV, f"{SVTAV1} -pix_fmt yuv420p -c:a libopus"),
    Synthetic("av1_hdr10_aac.mp4", AV, f"{SVTAV1} -pix_fmt yuv420p10le {PQ} -c:a aac"),
    Synthetic(
        "vp8_vorbis.webm",
        AV,
        "-c:v libvpx -deadline realtime -cpu-used 8 -c:a libvorbis",
    ),
    Synthetic("vp9_opus.webm", AV, f"{VP9} -c:a libopus"),
    Synthetic(
        "vp9_hlg_10bit.webm",
        AV,
        f"{VP9} -profile:v 2 -pix_fmt yuv420p10le {HLG} -c:a libopus",
    ),
    Synthetic("mpeg1_mp2.mpg", AV, "-c:v mpeg1video -c:a mp2"),
    Synthetic(
        "mpeg2_ac3.vob",
        AV,
        "-c:v mpeg2video -c:a ac3 -f vob",
        settings={"size": "720x576", "rate": "25"},
    ),
    Synthetic(
        "mpeg2_mp2.mpeg",
        AV,
        "-c:v mpeg2video -c:a mp2 -f dvd",
        settings={"size": "720x480", "rate": "30000/1001"},
    ),
    Synthetic("mpeg4_mp3.avi", AV, "-c:v mpeg4 -c:a libmp3lame"),
    Synthetic("xvid_mp3.avi", AV, "-c:v libxvid -c:a libmp3lame"),
    Synthetic(
        "mpeg4_aac.3gp",
        AV,
        "-c:v mpeg4 -c:a aac -ac 1",
        settings={"size": "352x288", "audio_rate": "16000"},
    ),
    Synthetic("mpeg4_aac.m4v", AV, "-c:v mpeg4 -c:a aac"),
    Synthetic(
        "h263_amrnb.3gp",
        AV,
        "-c:v h263 -c:a libopencore_amrnb -ar 8000 -ac 1 -b:a 12.2k",
        settings={"size": "176x144", "rate": "15", "audio_rate": "8000"},
    ),
    Synthetic(
        "h264_amrwb.3gp",
        f"{VIDEO} -i [fate/amrwb/seed-12k65.awb]",
        f"{X264} -pix_fmt yuv420p -c:a copy -map 0:v -map 1:a -shortest",
        ["fate/amrwb/seed-12k65.awb"],
        {"size": "352x288", "rate": "15"},
    ),
    Synthetic(
        "mjpeg_pcm.avi",
        AV,
        "-c:v mjpeg -pix_fmt yuvj422p -c:a pcm_s16le",
        settings={"size": "640x480"},
    ),
    Synthetic(
        "mjpeg_pcm.mov",
        AV,
        "-c:v mjpeg -pix_fmt yuvj420p -c:a pcm_s16le",
        settings={"size": "640x480"},
    ),
    Synthetic(
        "prores422_pcm24.mov",
        AV,
        "-c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le -c:a pcm_s24le",
    ),
    Synthetic(
        "prores4444.mov",
        AV,
        "-c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le -c:a pcm_s16le",
    ),
    Synthetic(
        "dnxhr_pcm.mov",
        AV,
        "-c:v dnxhd -profile:v dnxhr_lb -pix_fmt yuv422p -c:a pcm_s16le",
        settings={"size": "1280x720"},
    ),
    Synthetic(
        "dv_pal_pcm.avi",
        AV,
        "-c:v dvvideo -pix_fmt yuv420p -c:a pcm_s16le -ac 2",
        settings={"size": "720x576", "rate": "25"},
    ),
    Synthetic(
        "dv_ntsc.mov",
        AV,
        "-c:v dvvideo -pix_fmt yuv411p -c:a pcm_s16le -ac 2",
        settings={"size": "720x480", "rate": "30000/1001"},
    ),
    Synthetic(
        "flv1_mp3.flv",
        AV,
        "-c:v flv -c:a libmp3lame",
        settings={"audio_rate": "44100"},
    ),
    Synthetic("wmv1_wmav1.wmv", AV, "-c:v wmv1 -c:a wmav1"),
    Synthetic("wmv2_wmav2.wmv", AV, "-c:v wmv2 -c:a wmav2"),
    Synthetic("msmpeg4v3_wmav2.asf", AV, "-c:v msmpeg4 -c:a wmav2"),
    Synthetic(
        "vc1_copy.wmv",
        "-i [fate/vc1/SA00040.vc1]",
        "-c copy",
        ["fate/vc1/SA00040.vc1"],
    ),
    Synthetic(
        "wmv3_copy.wmv",
        "-i [fate/vc1/SMM0005.rcv]",
        "-c copy",
        ["fate/vc1/SMM0005.rcv"],
    ),
    Synthetic("theora_vorbis.ogv", AV, "-c:v libtheora -q:v 7 -c:a libvorbis"),
    Synthetic("ffv1_flac.mkv", AV, "-c:v ffv1 -level 3 -c:a flac"),
]

SUBTITLES = "1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:00:01,500 --> 00:00:02,000\nWorld\n"


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tool(bindir: Path, name: str) -> str:
    suffix = ".exe" if os.name == "nt" else ""
    return str(bindir / f"{name}{suffix}")


def run(
    command: list[str], timeout: float = TIMEOUT
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(command, capture_output=True, timeout=timeout, check=False)


def fetch_fate(cache: Path) -> None:
    for relative, sha256 in FATE_SAMPLES.items():
        target = cache / relative
        if target.exists() and sha256_of(target) == sha256:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(FATE + relative, timeout=120) as response:
            target.write_bytes(response.read())
        actual = sha256_of(target)
        if actual != sha256:
            raise SystemExit(f"{relative}: sha256 {actual}, expected {sha256}")


def make_corpus(bindir: Path, corpus: Path) -> None:
    fetch_fate(corpus / "fate")
    (corpus / "subtitles.srt").write_text(SUBTITLES, encoding="utf-8")
    synthetic = corpus / "synthetic"
    synthetic.mkdir(parents=True, exist_ok=True)
    made = 0
    for item in SYNTHETIC:
        target = synthetic / item.name
        if any(not (corpus / need).exists() for need in item.needs):
            print("skipped", item.name, "(missing input)", flush=True)
            continue
        command = [
            tool(bindir, "ffmpeg"),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            *item.input_args(corpus),
            *item.output_args(),
            str(target),
        ]
        result = run(command)
        if result.returncode != 0 or not target.exists():
            print(
                "could not make",
                item.name,
                result.stderr.decode(errors="replace")[-400:],
                flush=True,
            )
            target.unlink(missing_ok=True)
            continue
        made += 1
    print(f"made {made} of {len(SYNTHETIC)} synthetic clips", flush=True)


def corpus_files(corpus: Path) -> list[tuple[str, Path]]:
    items = [
        (f"syn/{path.name}", path) for path in sorted((corpus / "synthetic").iterdir())
    ]
    items += [
        (f"fate/{relative}", corpus / "fate" / relative) for relative in FATE_SAMPLES
    ]
    return items


def listing(bindir: Path, option: str) -> list[str]:
    result = run([tool(bindir, "ffmpeg"), "-hide_banner", option], timeout=60)
    return result.stdout.decode(errors="replace").splitlines()


def codec_entries(lines: list[str]) -> dict[str, str]:
    entries = {}
    for line in lines:
        match = re.match(r"^ [VASDT.][A-Z.]{5} (\S+)\s+(.*)$", line)
        if not match or match.group(1) == "=":
            continue
        codec = re.search(r"\(codec (\S+)\)", match.group(2))
        entries[match.group(1)] = codec.group(1) if codec else match.group(1)
    return entries


def format_entries(lines: list[str]) -> set[str]:
    names = set()
    for line in lines:
        match = re.match(r"^ ([D ])([E ])([d ]) (\S+)", line)
        if match and match.group(3) != "d" and match.group(4) != "=":
            names.update(match.group(4).split(","))
    return names


def filter_entries(lines: list[str]) -> set[str]:
    return {
        fields[1]
        for fields in (line.split() for line in lines)
        if len(fields) > 2 and "->" in fields[2]
    }


def protocol_entries(lines: list[str]) -> set[str]:
    return {line.strip() for line in lines if line.startswith("  ")}


def bsf_entries(lines: list[str]) -> set[str]:
    return {line.strip() for line in lines[1:] if line.strip()}


def components(bindir: Path) -> dict[str, set[str]]:
    decoders = codec_entries(listing(bindir, "-decoders"))
    encoders = codec_entries(listing(bindir, "-encoders"))
    demuxers = set()
    muxers = set()
    for line in listing(bindir, "-formats"):
        match = re.match(r"^ ([D ])([E ])([d ]) (\S+)", line)
        if not match or match.group(3) == "d" or match.group(4) == "=":
            continue
        names = set(match.group(4).split(","))
        if match.group(1) == "D":
            demuxers |= names
        if match.group(2) == "E":
            muxers |= names
    help_text = run(
        [tool(bindir, "ffmpeg"), "-hide_banner", "-h", "full"], timeout=60
    ).stdout.decode(errors="replace")
    return {
        "decoders": set(decoders),
        "decoded_codecs": set(decoders.values()),
        "encoders": set(encoders),
        "demuxers": demuxers,
        "muxers": muxers,
        "filters": filter_entries(listing(bindir, "-filters")),
        "protocols": protocol_entries(listing(bindir, "-protocols")),
        "bsfs": bsf_entries(listing(bindir, "-bsfs")),
        "options": {
            line.strip().split(" ", 1)[0][1:]
            for line in help_text.splitlines()
            if line.strip().startswith("-")
        },
    }


def check(bindir: Path) -> int:
    found = components(bindir)
    missing = {
        kind: sorted(names - found[kind])
        for kind, names in REQUIRED.items()
        if names - found[kind]
    }
    print(
        run(
            [tool(bindir, "ffmpeg"), "-hide_banner", "-buildconf"], timeout=60
        ).stdout.decode(errors="replace")
    )
    for kind, names in found.items():
        print(f"{kind}: {len(names)}")
    if missing:
        print("missing:", json.dumps(missing))
        return 1
    return 0


def use_build(bindir: Path, base_path: str) -> None:
    os.environ["PATH"] = str(bindir) + os.pathsep + base_path
    ffmpeg_budget.reset_probe_cache()


def ffprobe_json(path: Path, entries: str) -> dict:
    result = binaries.run_tool(
        "ffprobe",
        ["-v", "error", "-show_entries", entries, "-of", "json", str(path)],
        timeout=60,
        check=False,
        text=True,
    )
    try:
        return json.loads(result.stdout) if result.returncode == 0 else {}
    except ValueError:
        return {}


def stream_summary(path: Path) -> list[str]:
    data = ffprobe_json(
        path,
        "stream=codec_type,codec_name,pix_fmt,color_transfer,width,height,sample_rate,channels:format=format_name",
    )
    streams = [
        ":".join(
            str(stream.get(key, ""))
            for key in (
                "codec_type",
                "codec_name",
                "pix_fmt",
                "color_transfer",
                "width",
                "height",
                "sample_rate",
                "channels",
            )
        )
        for stream in data.get("streams", [])
    ]
    return [data.get("format", {}).get("format_name", ""), *streams]


def video_shape(path: Path) -> str:
    if not path.exists() or path.stat().st_size == 0:
        return ""
    data = ffprobe_json(
        path, "stream=codec_name,width,height,pix_fmt:format=format_name"
    )
    video = [s for s in data.get("streams", []) if s.get("width")]
    if not video:
        return ""
    stream = video[0]
    return f"{stream.get('codec_name')} {stream.get('width')}x{stream.get('height')} {stream.get('pix_fmt')}"


def ffmpeg_writes_frame(args: list[str]) -> bool:
    try:
        stderr = binaries.run_tool("ffmpeg", args, timeout=TIMEOUT, check=False).stderr
    except binaries.ToolError:
        return False
    return NO_FRAME.encode() not in stderr


def with_editlist_retry(args: list[str], output: Path) -> str:
    if not (ffmpeg_writes_frame(args) and output.exists()):
        output.unlink(missing_ok=True)
        ffmpeg_writes_frame(["-ignore_editlist", "1", *args])
    return video_shape(output)


def thumbnail_args(source: Path, output: Path, transfer: str | None) -> list[str]:
    args = [
        "-y",
        "-i",
        str(source),
        "-ss",
        "00:00:00.000",
        "-vframes",
        "1",
        *NO_METADATA,
    ]
    tonemap = color.video_filter(str(source), transfer=transfer)
    if tonemap:
        args += ["-filter:v", tonemap]
    return [*args, str(output)]


def thumbnail(source: Path, out: Path, transfer: str | None) -> str:
    output = out / "thumbnail.webp"
    return with_editlist_retry(thumbnail_args(source, output, transfer), output)


def preview_args(source: Path, output: Path, transfer: str | None) -> list[str]:
    return [
        "-y",
        "-i",
        str(source),
        "-to",
        str(PREVIEW_SECONDS),
        "-vcodec",
        "libx264",
        "-crf",
        str(PREVIEW_CRF),
        "-an",
        *NO_METADATA,
        *color.h264_video_args(str(source), f"scale=-2:{SQUARE_HEIGHT}", transfer),
        str(output),
    ]


def preview(source: Path, out: Path, transfer: str | None) -> str:
    output = out / "preview.mp4"
    return with_editlist_retry(preview_args(source, output, transfer), output)


def live_args(source: Path, transfer: str | None) -> list[str]:
    args = ["-nostdin", "-loglevel", "error", "-threads", LIVE_THREADS]
    if ffmpeg_budget.supports("progress"):
        args += ["-progress", "pipe:2"]
    if ffmpeg_budget.supports("filter_threads"):
        args += ["-filter_threads", LIVE_THREADS]
    if ffmpeg_budget.supports("readrate"):
        args += ["-readrate", LIVE_READRATE]
        if ffmpeg_budget.supports("readrate_initial_burst"):
            args += ["-readrate_initial_burst", LIVE_BURST_SECONDS]
    args += [
        "-i",
        str(source),
        "-threads",
        LIVE_THREADS,
        "-vcodec",
        "libx264",
        "-preset",
        "ultrafast",
        "-movflags",
        "frag_keyframe+empty_moov",
        *NO_METADATA,
    ]
    return [
        *args,
        *color.h264_video_args(str(source), color.PLAYBACK_SCALE, transfer),
        "-f",
        "mp4",
        "-",
    ]


def live(source: Path, out: Path, transfer: str | None) -> str:
    output = out / "live.mp4"
    try:
        result = binaries.run_tool(
            "ffmpeg", live_args(source, transfer), timeout=TIMEOUT, check=False
        )
    except binaries.ToolError:
        return ""
    if result.returncode != 0:
        return ""
    output.write_bytes(result.stdout)
    return video_shape(output)


def cached_args(source: Path, destination: Path, transfer: str | None) -> list[str]:
    args = [
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-threads",
        CACHED_THREADS,
        "-vcodec",
        "libx264",
        "-preset",
        CACHED_PRESET,
    ]
    args += color.h264_video_args(str(source), color.PLAYBACK_SCALE, transfer)
    return [
        *args,
        *NO_METADATA,
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        str(destination),
    ]


def cached(source: Path, out: Path, transfer: str | None) -> str:
    output = out / "cached.mp4"
    try:
        result = binaries.run_tool(
            "ffmpeg",
            cached_args(source, output, transfer),
            timeout=TIMEOUT,
            check=False,
        )
    except binaries.ToolError:
        return ""
    return video_shape(output) if result.returncode == 0 else ""


def frame(source: Path, out: Path, transfer: str | None) -> str:
    output = out / "frame.jpg"
    duration = ffprobe_json(source, "format=duration").get("format", {}).get("duration")
    try:
        seconds = float(duration) / 4 if duration else 0.0
    except ValueError:
        seconds = 0.0
    try:
        binaries.run_tool(
            "ffmpeg",
            frames.frame_args(str(source), seconds, str(output), transfer),
            timeout=TIMEOUT,
        )
    except binaries.ToolError:
        return ""
    return video_shape(output)


def remux_args(source: Path, part: Path) -> list[str]:
    return [
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-map",
        "0:v",
        "-map",
        "0:a?",
        "-dn",
        "-sn",
        "-c",
        "copy",
        *VIDEO_NO_METADATA,
        str(part),
    ]


def remux(source: Path, out: Path, transfer: str | None) -> str:
    extension = source.suffix.lower()
    if extension not in VIDEO_EXTENSIONS:
        return "n/a"
    part = out / f"remux.part{extension}"
    try:
        binaries.run_tool("ffmpeg", remux_args(source, part), timeout=TIMEOUT)
    except binaries.ToolError:
        return ""
    return video_shape(part)


def run_pipelines(source: Path, work: Path) -> dict[str, str]:
    work.mkdir(parents=True, exist_ok=True)
    probed = color.probe(str(source))
    results = {
        "probe": " | ".join(stream_summary(source)),
        "transfer": (probed or {}).get("video_color_transfer", ""),
    }
    transfer = probed["video_color_transfer"] if probed else None
    for name, step in (
        ("thumbnail", thumbnail),
        ("preview", preview),
        ("live", live),
        ("cached", cached),
        ("frame", frame),
        ("remux", remux),
    ):
        results[name] = step(source, work, transfer)
    results["tonemapped"] = str(
        bool(
            transfer in color.HDR_TRANSFERS and ffmpeg_budget.supports_filter("zscale")
        )
    )
    return results


def cell(old: str, new: str, pipeline: str) -> str:
    if old == "n/a":
        return "n/a"
    if pipeline == "probe":
        return "same" if old == new else "differs"
    if old and new:
        return "ok" if old == new else "ok, differs"
    if old and not new:
        return "REGRESSION"
    if new and not old:
        return "fixed"
    return "fails in both"


def lost_components(
    old: dict[str, set[str]], new: dict[str, set[str]]
) -> dict[str, list[str]]:
    return {kind: sorted(old[kind] - new.get(kind, set())) for kind in old}


def matrix(old_bin: Path, new_bin: Path, corpus: Path, out: Path) -> int:
    base_path = os.environ.get("PATH", "")
    out.mkdir(parents=True, exist_ok=True)
    old_components = components(old_bin)
    new_components = components(new_bin)
    lost = lost_components(old_components, new_components)
    rows = []
    for name, path in corpus_files(corpus):
        row: dict[str, dict[str, str]] = {}
        for label, bindir in (("old", old_bin), ("new", new_bin)):
            use_build(bindir, base_path)
            with tempfile.TemporaryDirectory() as work:
                row[label] = run_pipelines(path, Path(work))
        rows.append((name, row))
        print(
            name,
            {p: cell(row["old"][p], row["new"][p], p) for p in PIPELINES},
            flush=True,
        )
    os.environ["PATH"] = base_path
    regressions = sorted(
        f"{name} {pipeline}"
        for name, row in rows
        for pipeline in PIPELINES
        if cell(row["old"][pipeline], row["new"][pipeline], pipeline) == "REGRESSION"
    )
    unexpected_regressions = [
        r for r in regressions if r.split(" ")[0] not in EXPECTED_REGRESSIONS
    ]
    unexpected_codecs = [
        c for c in lost["decoded_codecs"] if c not in EXPECTED_LOST_CODECS
    ]
    unexpected_demuxers = [
        d for d in lost["demuxers"] if d not in EXPECTED_LOST_DEMUXERS
    ]
    report = {
        "old": str(old_bin),
        "new": str(new_bin),
        "counts": {
            kind: {"old": len(old_components[kind]), "new": len(new_components[kind])}
            for kind in old_components
        },
        "lost": lost,
        "rows": {name: row for name, row in rows},
        "regressions": regressions,
        "unexpected": {
            "regressions": unexpected_regressions,
            "codecs": unexpected_codecs,
            "demuxers": unexpected_demuxers,
        },
    }
    (out / "matrix.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (out / "matrix.md").write_text(markdown(report, rows), encoding="utf-8")
    print(json.dumps(report["unexpected"], indent=2))
    return 1 if any(report["unexpected"].values()) else 0


def losses(names: list[str], reasons: dict[str, str]) -> list[str]:
    return [f"- `{name}`: {reasons.get(name, 'NOT EXPECTED')}" for name in names] or [
        "- none"
    ]


def markdown(report: dict, rows: list[tuple[str, dict[str, dict[str, str]]]]) -> str:
    lines = [
        "| Clip | " + " | ".join(PIPELINES) + " | HDR tonemap (old/new) |",
        "|---" * (len(PIPELINES) + 2) + "|",
    ]
    for name, row in rows:
        cells = [cell(row["old"][p], row["new"][p], p) for p in PIPELINES]
        lines.append(
            f"| {name} | "
            + " | ".join(cells)
            + f" | {row['old']['tonemapped']}/{row['new']['tonemapped']} |"
        )
    lines += ["", "| Component | old | new |", "|---|--:|--:|"]
    lines += [
        f"| {kind} | {count['old']} | {count['new']} |"
        for kind, count in report["counts"].items()
    ]
    lines += ["", "Codecs no decoder reads any more:", ""]
    lines += losses(report["lost"]["decoded_codecs"], EXPECTED_LOST_CODECS)
    lines += ["", "Demuxers gone:", ""]
    lines += losses(report["lost"]["demuxers"], EXPECTED_LOST_DEMUXERS)
    lines += ["", "Regressions: " + (", ".join(report["regressions"]) or "none"), ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare two ffmpeg builds on a clip corpus through LibrePhotos' own ffmpeg pipelines."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    corpus_parser = commands.add_parser("corpus")
    corpus_parser.add_argument("bindir", type=Path)
    corpus_parser.add_argument("corpus", type=Path)
    check_parser = commands.add_parser("check")
    check_parser.add_argument("bindir", type=Path)
    matrix_parser = commands.add_parser("matrix")
    matrix_parser.add_argument("old", type=Path)
    matrix_parser.add_argument("new", type=Path)
    matrix_parser.add_argument("corpus", type=Path)
    matrix_parser.add_argument("out", type=Path)
    args = parser.parse_args()
    if args.command == "corpus":
        make_corpus(args.bindir.resolve(), args.corpus.resolve())
    elif args.command == "check":
        sys.exit(check(args.bindir.resolve()))
    else:
        sys.exit(
            matrix(
                args.old.resolve(),
                args.new.resolve(),
                args.corpus.resolve(),
                args.out.resolve(),
            )
        )


if __name__ == "__main__":
    main()
